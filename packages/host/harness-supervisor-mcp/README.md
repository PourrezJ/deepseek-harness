---
description: "Loopback Streamable HTTP MCP surface for supervising existing DeepSeek Harness sessions through SessionController, intended for authenticated Secure Tunnel access."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-harness-supervisor-mcp

English | [中文](README.zh.md)

## Summary

This package exposes a deliberately narrow MCP control surface over the host's existing `SessionController`. It lets an authenticated external supervisor list Harness sessions, inspect a bounded recent snapshot, queue or steer a prompt into an existing session, cancel its active turn, and wait for it to become idle. It does not create sessions, expose a filesystem or shell, or bypass Harness session ownership. The HTTP listener binds only to `127.0.0.1`; deployments that need remote access should place an authenticated tunnel in front of that loopback endpoint instead of publishing the port directly.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package only in a host profile that is meant to be supervised. A typical local composition uses port `31977` and path `/mcp`; the service always binds the loopback address itself.

```yaml
- id: harness-supervisor-mcp
  name: '@deepseek-ai/dsh-host-harness-supervisor-mcp'
  config:
    port: 31977
    path: /mcp
```

Point the authenticated tunnel runtime at `http://127.0.0.1:31977/mcp`. Do not expose the Web UI port or bind this MCP listener to `0.0.0.0` as a substitute for tunnel authentication.

### Tool surface

The server publishes five tools. `harness_list_sessions` returns recent session summaries; `harness_session_snapshot` returns bounded durable events for one session; `harness_prompt_session` sends text through `SessionController.prompt` in `queue` or `steer` mode; `harness_cancel_session` requests cancellation of the active turn; and `harness_wait_session` polls the session's running state until it settles or the caller's timeout expires, then returns a recent snapshot.

### Result and transport bounds

Individual strings and arrays are bounded before serialization, and every text tool result is capped at 64 KiB of UTF-8. When the complete JSON result would exceed that cap, the service returns a truncation envelope containing the original byte count and a UTF-8-safe preview. Requests are accepted only on the configured path and must pass localhost Host and Origin validation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The package is an adapter, not a second agent runtime. Every operation delegates to the composed `SessionController`, so prompts, cancellation, inspection, and running state follow the same ownership and persistence rules as the ordinary Harness host. The MCP server never constructs its own coding agent and never opens a direct filesystem or process-control path.

### Lifecycle and security boundary

`HarnessSupervisorMcp` owns one Node HTTP listener on `127.0.0.1` and one Streamable HTTP MCP handler. Cordis disposal first closes the listener and active connections, then closes the MCP handler. The package validates the exact request pathname before protocol dispatch and applies the MCP SDK's localhost Host and Origin guards before handing a request to the protocol server.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis service, loopback HTTP lifecycle, MCP tool registration, bounded result projection |
| [`tests/supervisor-mcp.spec.ts`](tests/supervisor-mcp.spec.ts) | Real HTTP MCP composition tests for tools, byte bounds, Host/Origin rejection, and disposal |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session Controller](../../api/session-controller/README.md) — host session ownership and the methods this adapter delegates to.
- [Host package map](../README.md) — where this optional service sits among the Web host packages.
- [Web app bundle](../../bundle/web-app/README.md) — the bundle that can carry the package while a user profile chooses whether to mount it.

-----

<a id="model-experience"></a>
## Model Experience

### MCP supervision tools

#### What the model sees

The supervising MCP client sees the five `harness_*` tool names, their descriptions, their validated arguments, and bounded JSON text results. The supervised Harness model sees none of the list, snapshot, cancel, or wait traffic; only text explicitly sent through `harness_prompt_session` enters that Harness session as a normal user message through `SessionController.prompt`.

#### Token effect

Tool definitions and returned JSON consume context in the supervising model. In the supervised Harness session, only an accepted `harness_prompt_session` message adds durable user-message tokens; read-only inspection does not copy its result back into the Harness model context.

#### KV Cache effect

Supervisor reads do not alter the Harness model prefix. A queued supervision prompt appends a normal user turn and can reuse the existing Harness prefix when the selected route remains compatible; a steer request follows the active-turn semantics owned by `SessionController` rather than creating a parallel cache lineage.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints are intentional boundaries of the supervisor surface.

- **Existing sessions only** — there is no create-session tool; the caller must select a session the Harness host already owns.
- **Text supervision only** — `harness_prompt_session` accepts text and does not inject attachments or arbitrary Session events.
- **Bounded observability** — snapshots and list results are intentionally truncated and are not a bulk transcript export API.
- **Tunnel authentication lives outside this package** — the service supplies a loopback endpoint; deployment authentication and remote reachability belong to the chosen secure tunnel runtime.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep this package narrow: supervision should continue to flow through `SessionController`, and new tools should not become a general-purpose shell, filesystem, or session-creation backdoor.

</details>
