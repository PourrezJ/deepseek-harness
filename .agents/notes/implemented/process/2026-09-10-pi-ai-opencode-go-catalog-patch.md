# Agent Note: Patch pi-ai's generated opencode-go catalog for deepseek-v4.1-flash

Status: implemented

English | [中文](2026-09-10-pi-ai-opencode-go-catalog-patch.zh.md)

## Problem

OpenCode Go added DeepSeek V4.1 Flash (`deepseek-v4.1-flash`) to its endpoint ([endpoints](https://opencode.ai/docs/go/#endpoints)), and models.dev carries the entry, but `@earendil-works/pi-ai@0.85.1` generated its catalog data on 2026-09-05, before the model was registered upstream. The `opencode-go` route serves its model list straight from that generated catalog, so the model was absent from every selector the harness offers.

## Decision

A [pnpm patch](../../../../patches/@earendil-works__pi-ai@0.85.1.patch) adds the flattened `deepseek-v4.1-flash` entry to the installed package's `dist/providers/data/opencode-go.json`, derived from models.dev and mirroring the shipped `deepseek-v4-flash-vision-exp` entry: `openai-completions` at `https://opencode.ai/zen/go/v1`, text and image input, a 1,000,000-token context window, a 384,000-token output cap, the DeepSeek compat block, and the low, high, and max thinking levels. A [catalog spec](../../../../packages/llm/llm-pi-ai/tests/catalog.spec.ts) case serves the route with no configuration and fails, naming the patch, while the entry is missing. [pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) states the drop condition beside the patch registration.

## Alternatives considered

**Bump pi-ai.** 0.85.1 is the newest release; no published version carries the model.

**Declare the model in settings configuration.** A `models` entry on a catalog route already accepts a model the installed catalog lacks, but that is per-deployment configuration: every deployment repeats the declaration, and the model still never appears in the offered directory.

**Add a dsh-owned catalog overlay in llm-pi-ai.** A merge layer splicing entries into pi-ai's catalog is owned code and owned tests guarding a data fix the dependency will ship; the patch is the smaller surface and is deleted, not maintained, once upstream catches up.

## Consequences

The model is selectable wherever the `opencode-go` route is, with no configuration. The patch is registered against `@earendil-works/pi-ai@0.85.1`, so a later pi-ai bump installs unpatched and the guard test decides: it passes once upstream's own catalog carries the model and fails while it does not, naming the patch to re-apply or drop. The patched cost figures can drift from models.dev updates; the harness never reads pi-ai's cost metadata, so that drift is inert.
