import { Buffer } from 'node:buffer'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import HarnessSupervisorMcp from '../src/index.ts'

const SESSION_ID = 'supervisor-session'
const MAX_RESULT_BYTES = 64 * 1024

interface ControllerFixture {
  controller: SessionController
  list: ReturnType<typeof vi.fn>
  inspect: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function inspection(events: unknown[] = [{
  type: 'user/message',
  seq: 0,
  time: 1,
  data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
}]): unknown {
  return {
    meta: {
      version: 3,
      id: SESSION_ID,
      createdAt: 1,
      cwd: 'C:\\workspace',
      isSeeded: false,
    },
    inheritedEventCount: 0,
    events,
  }
}

function controllerFixture(options: { events?: unknown[]; running?: boolean } = {}): ControllerFixture {
  const list = vi.fn(async () => ({
    items: [{
      sessionId: SESSION_ID,
      updatedAt: 123,
      running: options.running ?? false,
      blank: false,
      cwd: 'C:\\workspace',
      projections: {
        asOfSeq: 1,
        values: {
          title: 'Supervisor test',
          ignoredProjection: { shouldNotLeak: true },
        },
      },
    }],
  }))
  const inspect = vi.fn(async (sessionId: string) => {
    if (sessionId !== SESSION_ID) throw new Error(`missing session: ${sessionId}`)
    return inspection(options.events)
  })
  const prompt = vi.fn(async () => ({ accepted: true as const }))
  const cancel = vi.fn(() => ({ accepted: true as const }))
  return {
    controller: { list, inspect, prompt, cancel } as unknown as SessionController,
    list,
    inspect,
    prompt,
    cancel,
  }
}

interface McpCallResult {
  isError?: boolean
  content: Array<{ type: string; text?: string }>
}

function textOf(result: McpCallResult): string {
  const part = result.content.find(item => item.type === 'text')
  if (part?.type !== 'text' || part.text === undefined) throw new Error('expected MCP text result')
  return part.text
}

let nextRequestId = 1

async function mcpRequest(url: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = nextRequestId++
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`MCP HTTP ${String(response.status)}: ${body}`)
  const raw = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split('\n').find(line => line.startsWith('data: '))?.slice(6)
    : body
  if (raw === undefined) throw new Error(`MCP response had no JSON payload: ${body}`)
  const message = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } }
  if (message.id !== id) throw new Error(`MCP response id mismatch: ${String(message.id)}`)
  if (message.error !== undefined) throw new Error(message.error.message ?? 'MCP request failed')
  return message.result
}

async function callTool(url: string, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  return await mcpRequest(url, 'tools/call', { name, arguments: args }) as McpCallResult
}

async function status(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
    }, (response) => {
      response.resume()
      response.once('end', () => { resolve(response.statusCode ?? 0) })
    })
    req.once('error', reject)
    req.end('{}')
  })
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function mount(controller: SessionController): Promise<HarnessSupervisorMcp> {
  context = new Context()
  context.provide('sessionController', controller)
  await context.plugin(HarnessSupervisorMcp, { port: 0, path: '/mcp' }).await()
  return context.harnessSupervisorMcp
}

describe('Harness Supervisor MCP HTTP surface', () => {
  it('lists tools and supervises list, snapshot, prompt, cancel, and wait through MCP', async () => {
    const fixture = controllerFixture()
    const service = await mount(fixture.controller)

    const tools = await mcpRequest(service.url, 'tools/list', {}) as { tools: Array<{ name: string }> }
    expect(tools.tools.map(tool => tool.name)).toEqual([
      'harness_list_sessions',
      'harness_session_snapshot',
      'harness_prompt_session',
      'harness_cancel_session',
      'harness_wait_session',
    ])

    const listed = JSON.parse(textOf(await callTool(service.url, 'harness_list_sessions', { limit: 1 }))) as Record<string, unknown>
    expect(listed).toMatchObject({
      count: 1,
      sessions: [{
        sessionId: SESSION_ID,
        running: false,
        cwd: 'C:\\workspace',
        projections: { values: { title: 'Supervisor test' } },
      }],
    })
    expect(JSON.stringify(listed)).not.toContain('ignoredProjection')

    const snapshot = JSON.parse(textOf(await callTool(service.url, 'harness_session_snapshot', {
      session_id: SESSION_ID, max_events: 10,
    }))) as Record<string, unknown>
    expect(snapshot).toMatchObject({ totalEvents: 1, inheritedEventCount: 0 })

    const prompted = JSON.parse(textOf(await callTool(service.url, 'harness_prompt_session', {
      session_id: SESSION_ID, text: 'check the failing test', mode: 'steer',
    }))) as { requestId: string; mode: string; accepted: boolean }
    expect(prompted).toMatchObject({ accepted: true, mode: 'steer' })
    expect(prompted.requestId).toMatch(/^chatgpt-supervisor-/)
    expect(fixture.prompt).toHaveBeenCalledWith(expect.objectContaining({
      requestId: prompted.requestId,
      sessionId: SESSION_ID,
      mode: 'steer',
      content: [{ type: 'text', text: 'check the failing test' }],
    }), expect.any(AbortSignal))

    expect(JSON.parse(textOf(await callTool(service.url, 'harness_cancel_session', {
      session_id: SESSION_ID,
    })))).toEqual({ accepted: true })
    expect(fixture.cancel).toHaveBeenCalledWith({ sessionId: SESSION_ID })

    const waited = JSON.parse(textOf(await callTool(service.url, 'harness_wait_session', {
      session_id: SESSION_ID, timeout_seconds: 1, max_events: 10,
    }))) as Record<string, unknown>
    expect(waited).toMatchObject({ timedOut: false, running: false, snapshot: { totalEvents: 1 } })
    expect(fixture.inspect).toHaveBeenCalledWith(SESSION_ID)
  }, 30_000)

  it('caps the complete UTF-8 MCP text result without splitting multibyte characters', async () => {
    const events = Array.from({ length: 30 }, (_, index) => ({
      type: 'assistant/message',
      seq: index,
      time: index,
      data: { content: '界'.repeat(4_000) },
    }))
    const fixture = controllerFixture({ events })
    const service = await mount(fixture.controller)

    const result = await callTool(service.url, 'harness_session_snapshot', {
      session_id: SESSION_ID, max_events: 30,
    })
    const text = textOf(result)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(MAX_RESULT_BYTES)
    expect(text).not.toContain('\uFFFD')
    expect(JSON.parse(text)).toMatchObject({ truncated: true })
    expect((JSON.parse(text) as { originalBytes: number }).originalBytes).toBeGreaterThan(MAX_RESULT_BYTES)
  }, 30_000)

  it('rejects non-local Host and Origin headers before MCP dispatch', async () => {
    const fixture = controllerFixture()
    const service = await mount(fixture.controller)

    expect(await status(service.url, { host: 'evil.example' })).toBe(403)
    expect(await status(service.url, {
      host: new URL(service.url).host,
      origin: 'https://evil.example',
    })).toBe(403)
    expect(fixture.list).not.toHaveBeenCalled()
  })

  it('closes the loopback listener when its Cordis lifecycle is disposed', async () => {
    const fixture = controllerFixture()
    const service = await mount(fixture.controller)
    const url = service.url

    await context?.fiber.dispose()
    context = undefined

    await expect(fetch(url)).rejects.toThrow()
  })
})
