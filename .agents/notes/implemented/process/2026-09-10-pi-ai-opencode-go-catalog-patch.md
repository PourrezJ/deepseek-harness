# Agent Note: Refresh pi-ai's generated opencode-go catalog

Status: implemented

English | [中文](2026-09-10-pi-ai-opencode-go-catalog-patch.zh.md)

## Problem

OpenCode Go's public model set changed after `@earendil-works/pi-ai@0.85.1` generated its catalog data on 2026-09-05. DeepSeek V4.1 Flash (`deepseek-v4.1-flash`) was added, while Omen Alpha (`omen-alpha`) is no longer in the public Go model list. The `opencode-go` route serves its model list straight from that generated catalog, so Harness otherwise omits the new model and keeps offering the retired one.

## Decision

A [pnpm patch](../../../../patches/@earendil-works__pi-ai@0.85.1.patch) refreshes the installed package's `dist/providers/data/opencode-go.json`: it adds the generated `deepseek-v4.1-flash` entry and removes `omen-alpha`. The new DeepSeek entry is the current generated pi-ai data: `openai-completions` at `https://opencode.ai/zen/go/v1`, text and image input, a 1,000,000-token context window, a 384,000-token output cap, the DeepSeek compat block, and low, high, and max thinking levels. A [catalog spec](../../../../packages/llm/llm-pi-ai/tests/catalog.spec.ts) guards both changes. [pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) states the drop condition beside the patch registration.

## Alternatives considered

**Bump pi-ai.** 0.85.1 is the newest release; no published version carries the refreshed set.

**Declare the model in settings configuration.** A `models` entry on a catalog route already accepts a model the installed catalog lacks, but that is per-deployment configuration: every deployment repeats the declaration, and the model still never appears in the offered directory.

**Add a dsh-owned catalog overlay in llm-pi-ai.** A merge layer splicing entries into pi-ai's catalog is owned code and owned tests guarding a data fix the dependency will ship; the patch is the smaller surface and is deleted, not maintained, once upstream catches up.

## Consequences

DeepSeek V4.1 Flash is selectable wherever the `opencode-go` route is, and Omen Alpha no longer appears in that catalog. The patch is registered against `@earendil-works/pi-ai@0.85.1`, so a later pi-ai bump installs unpatched and the guard test decides whether the patch can be dropped. The patch changes model availability only; existing 0.85.1 metadata for unchanged Go models stays untouched.
