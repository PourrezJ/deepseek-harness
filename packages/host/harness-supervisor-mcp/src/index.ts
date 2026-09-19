/**
 * A deliberately narrow MCP surface for supervising ordinary Harness Sessions.
 *
 * The server binds loopback only. Internet reachability is expected to be supplied
 * by an authenticated OpenAI Secure Tunnel (tunnel-client), not by binding the
 * Harness process to a public interface.
 */

import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  SessionController,
  SessionListValue,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller'
import schema from '@deepseek-ai/schemastery'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from '@modelcontextprotocol/node'
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessSupervisorMcp: HarnessSupervisorMcp
  }
}

/** Loopback endpoint configuration. */
export interface Config {
  /** Loopback TCP port. Use 0 for an ephemeral test port. */
  readonly port: number
  /** Streamable HTTP MCP pathname. */
  readonly path: string
}

const DEFAULT_PORT = 31_977
const DEFAULT_PATH = '/mcp'
const MAX_EVENT_STRING = 4_000
const MAX_ARRAY_ITEMS = 80
const MAX_RESULT_BYTES = 64 * 1024

type SessionId = Parameters<SessionController['inspect']>[0]

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = Math.max(0, maxBytes)
  while (end > 0) {
    const byte = bytes[end]
    if (byte === undefined || (byte & 0xC0) !== 0x80) break
    end -= 1
  }
  return bytes.subarray(0, end).toString('utf8')
}

function resultText(value: unknown): string {
  const full = JSON.stringify(value, null, 2)
  const originalBytes = Buffer.byteLength(full, 'utf8')
  if (originalBytes <= MAX_RESULT_BYTES) return full

  let previewBytes = Math.max(0, MAX_RESULT_BYTES - 512)
  while (true) {
    const preview = truncateUtf8(full, previewBytes)
    const envelope = JSON.stringify({
      truncated: true,
      originalBytes,
      preview,
    }, null, 2)
    if (Buffer.byteLength(envelope, 'utf8') <= MAX_RESULT_BYTES) return envelope
    previewBytes = Math.max(0, previewBytes - 512)
  }
}

function textResult(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: resultText(value) }],
  }
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{
      type: 'text',
      text: truncateUtf8(message, MAX_RESULT_BYTES),
    }],
  }
}

/** Keep snapshots useful without sending attachment/base64-sized Session rows through MCP. */
function boundedJson(value: unknown, depth = 0): unknown {
  if (depth > 10) return '[depth limit]'
  if (typeof value === 'string') {
    return value.length <= MAX_EVENT_STRING
      ? value
      : `${value.slice(0, MAX_EVENT_STRING)}… [${String(value.length - MAX_EVENT_STRING)} chars omitted]`
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => boundedJson(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[${String(value.length - MAX_ARRAY_ITEMS)} items omitted]`)
    return items
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    boundedJson(item, depth + 1),
  ]))
}

function visibleSummary(summary: SessionSummary): unknown {
  const projections = summary.projections
  const values = projections?.values
  return boundedJson({
    sessionId: summary.sessionId,
    updatedAt: summary.updatedAt,
    running: summary.running,
    blank: summary.blank,
    cwd: summary.cwd,
    parentSessionId: summary.parentSessionId,
    origin: summary.origin,
    projections: projections === undefined ? undefined : {
      asOfSeq: projections.asOfSeq,
      values: {
        title: values?.title,
        goal: values?.goal,
        modelSelection: values?.modelSelection,
        sessionListMetadata: values?.sessionListMetadata,
        plan: values?.plan,
        subagent: values?.subagent,
      },
    },
  })
}

async function listSessions(controller: SessionController): Promise<SessionListValue> {
  return controller.list({}, new AbortController().signal)
}

async function sessionSnapshot(
  controller: SessionController,
  sessionId: string,
  maxEvents: number,
): Promise<unknown> {
  const list = await listSessions(controller)
  const summary = list.items.find(item => item.sessionId === sessionId)
  const inspection = await controller.inspect(sessionId as SessionId)
  const events = inspection.events.slice(Math.max(0, inspection.events.length - maxEvents))
  return boundedJson({
    summary: summary === undefined ? undefined : visibleSummary(summary),
    header: inspection.meta,
    inheritedEventCount: inspection.inheritedEventCount,
    totalEvents: inspection.events.length,
    events,
  })
}

/**
 * Build one protocol server so tests and the HTTP service share exactly the same tools.
 *
 * @param controller SessionController that owns the existing Harness sessions.
 * @returns MCP server exposing the bounded supervision tool surface.
 */
export function createSupervisorMcp(controller: SessionController): McpServer {
  const mcp = new McpServer(
    { name: 'deepseek-harness-supervisor', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  mcp.registerTool('harness_list_sessions', {
    description: 'List recent DeepSeek Harness sessions, including their running state and workspace.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20),
    }),
  }, async ({ limit }): Promise<CallToolResult> => {
    try {
      const value = await listSessions(controller)
      return textResult({
        count: Math.min(limit, value.items.length),
        sessions: value.items.slice(0, limit).map(visibleSummary),
      })
    } catch (error) {
      return errorResult(error)
    }
  })

  mcp.registerTool('harness_session_snapshot', {
    description: 'Inspect one Harness session without starting a second agent. Returns bounded recent durable events.',
    inputSchema: z.object({
      session_id: z.string().min(1),
      max_events: z.number().int().min(1).max(100).default(30),
    }),
  }, async ({ session_id, max_events }): Promise<CallToolResult> => {
    try {
      return textResult(await sessionSnapshot(controller, session_id, max_events))
    } catch (error) {
      return errorResult(error)
    }
  })

  mcp.registerTool('harness_prompt_session', {
    description: 'Send a supervision instruction to an existing Harness session through SessionController. Queue waits behind the active turn; steer targets the active turn when supported.',
    inputSchema: z.object({
      session_id: z.string().min(1),
      text: z.string().trim().min(1),
      mode: z.enum(['queue', 'steer']).default('queue'),
    }),
  }, async ({ session_id, text, mode }): Promise<CallToolResult> => {
    try {
      const requestId = `chatgpt-supervisor-${randomUUID()}` as Parameters<SessionController['prompt']>[0]['requestId']
      const result = await controller.prompt({
        requestId,
        sessionId: session_id as SessionId,
        mode,
        content: [{ type: 'text', text }],
      }, new AbortController().signal)
      return textResult({ ...result, sessionId: session_id, requestId, mode })
    } catch (error) {
      return errorResult(error)
    }
  })

  mcp.registerTool('harness_cancel_session', {
    description: 'Request cancellation of the active turn in one Harness session without deleting its queued prompts.',
    inputSchema: z.object({
      session_id: z.string().min(1),
    }),
  }, async ({ session_id }): Promise<CallToolResult> => {
    try {
      return textResult(controller.cancel({ sessionId: session_id as SessionId }))
    } catch (error) {
      return errorResult(error)
    }
  })

  mcp.registerTool('harness_wait_session', {
    description: 'Wait until a Harness session stops running (or timeout), then return a bounded recent snapshot. Useful for supervising a long coding turn.',
    inputSchema: z.object({
      session_id: z.string().min(1),
      timeout_seconds: z.number().int().min(1).max(120).default(30),
      max_events: z.number().int().min(1).max(100).default(30),
    }),
  }, async ({ session_id, timeout_seconds, max_events }): Promise<CallToolResult> => {
    try {
      const deadline = Date.now() + timeout_seconds * 1_000
      let running: boolean | undefined
      do {
        const value = await listSessions(controller)
        const summary = value.items.find(item => item.sessionId === session_id)
        if (summary === undefined) throw new Error(`Harness session not found: ${session_id}`)
        running = summary.running
        if (!running) break
        await new Promise(resolve => setTimeout(resolve, 750))
      } while (Date.now() < deadline)

      return textResult({
        timedOut: running === true,
        running,
        snapshot: await sessionSnapshot(controller, session_id, max_events),
      })
    } catch (error) {
      return errorResult(error)
    }
  })

  return mcp
}

/** Harness-hosted loopback Streamable HTTP MCP server. */
export class HarnessSupervisorMcp extends Service {
  static inject = ['sessionController']

  static Config: schema<Config> = schema.object({
    port: schema.natural().max(65_535).default(DEFAULT_PORT),
    path: schema.string().pattern(/^\/[^?#]*$/u).default(DEFAULT_PATH),
  })

  private server!: Server
  private handler!: ReturnType<typeof createMcpHandler>
  private listenedPort!: number
  private readonly endpointPath: string

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'harnessSupervisorMcp')
    this.endpointPath = config.path
    if (!/^\/[^?#]*$/u.test(this.endpointPath)) {
      throw new Error('harness-supervisor-mcp: path must be an absolute pathname without a query or fragment')
    }
  }

  /** Local endpoint for tunnel-client. */
  get url(): string {
    return `http://127.0.0.1:${String(this.listenedPort)}${this.endpointPath}`
  }

  async [Service.init](): Promise<void> {
    const controller = this.ctx.sessionController
    this.handler = createMcpHandler(() => createSupervisorMcp(controller))
    const handle = toNodeHandler(this.handler)
    const checkHost = localhostHostValidation()
    const checkOrigin = localhostOriginValidation()

    this.server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path !== this.endpointPath) {
        response.writeHead(404).end()
        return
      }
      if (!checkHost(request, response) || !checkOrigin(request, response)) return
      void handle(request as NodeIncomingMessageLike, response).catch((error: unknown) => {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
    })

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, '127.0.0.1', () => {
        this.server.off('error', reject)
        this.listenedPort = (this.server.address() as AddressInfo).port
        resolve()
      })
    })

    this.ctx.logger.info(`Harness Supervisor MCP listening on ${this.url}`)
    this.ctx.effect(() => async () => {
      await new Promise<void>((resolve) => {
        this.server.close(() => { resolve() })
        this.server.closeAllConnections()
      })
      await this.handler.close()
    }, 'harness-supervisor-mcp.listen')
  }
}

export default HarnessSupervisorMcp
