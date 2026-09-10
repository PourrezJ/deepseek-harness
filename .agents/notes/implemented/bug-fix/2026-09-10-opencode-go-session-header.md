# Agent Note: Send the opencode-go session header from the seam session id

Status: implemented

English | [中文](2026-09-10-opencode-go-session-header.zh.md)

## Problem

OpenCode Go routes and prompt-caches per conversation, keyed on a stable `x-opencode-session` header ([Where can I use it?](https://opencode.ai/docs/go/#where-can-i-use-it)); requests without it are refused efficient routing, and the endpoint's documentation lists DeepSeek Harness among clients whose session support is incomplete (discussion #5495). pi-ai 0.85.1 maps its `sessionId` option only to the affinity headers its compat flags name, and the opencode-go catalog entries set none of them, so no request from this repository carried the header.

## Decision

The llm-pi-ai adapter derives `x-opencode-session` from the seam's `GenerateOptions.sessionId` on `opencode-go` requests. Main, compaction, and session-title calls all stamp the same session identity, so one conversation sends one stable value across all of its model requests. A deployment-configured header wins (HTTP header names are case-insensitive), a request without a session id sends none, and Harness attribution headers keep winning name collisions.

## Alternatives considered

**Rely on pi-ai's `sessionId` mapping.** pi-ai emits its `x-session-affinity` header family only when a model's compat sets `sendSessionAffinityHeaders` — a field this repository withholds from configuration — and opencode-go entries do not set it, so the header would never fire.

**Send the header through catalog data.** `Model.headers` is static catalog content; a per-conversation value cannot live there, and one shared static id would pool every conversation into a single routing bucket.

**Leave the header to deployment configuration.** Profile `headers` values are static strings, so each deployment would repeat a value that cannot vary per conversation, reproducing the pooled-bucket problem.

## Consequences

`opencode-go` requests route and cache per conversation with no configuration. A hand-declared route pointed at the Go endpoint under another provider name receives no header; such a deployment states its own static header. A pi-ai release that maps `sessionId` to `x-opencode-session` itself would make this derivation duplicate a same-valued header, so the derivation is dropped once upstream covers the route — the same review the catalog patch is waiting on.

## Testing

The adapter spec covers sending on `opencode-go`, absence on another provider, the case-insensitive deployment override, and absence when the request names no session.
