# Agent Note: 刷新 pi-ai 生成的 opencode-go 目录

Status: implemented

[English](2026-09-10-pi-ai-opencode-go-catalog-patch.md) | 中文

## 问题

OpenCode Go 的公开模型集合在 `@earendil-works/pi-ai@0.85.1` 于 2026-09-05 生成目录数据之后发生了变化。DeepSeek V4.1 Flash（`deepseek-v4.1-flash`）已加入，而 Omen Alpha（`omen-alpha`）已不再出现在公开的 Go 模型列表中。`opencode-go` 路由直接从该生成目录提供模型，因此若不修正，Harness 会漏掉新模型并继续提供已退役模型。

## 决策

一个 [pnpm 补丁](../../../../patches/@earendil-works__pi-ai@0.85.1.patch) 刷新已安装包的 `dist/providers/data/opencode-go.json`：加入生成的 `deepseek-v4.1-flash` 条目，并移除 `omen-alpha`。新的 DeepSeek 条目采用当前 pi-ai 生成数据：`https://opencode.ai/zen/go/v1` 上的 `openai-completions`，文本与图像输入，1,000,000 令牌上下文窗口，384,000 令牌输出上限，DeepSeek compat 块，以及 low、high、max 思考级别。一个[目录规格测试](../../../../packages/llm/llm-pi-ai/tests/catalog.spec.ts)同时守卫这两项变化。[pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) 在补丁注册处写明移除条件。

## 已考虑的替代方案

**升级 pi-ai。** 0.85.1 是最新发布版本；没有任何已发布版本携带刷新的模型集合。

**在 settings 配置中声明该模型。** 目录路由上的 `models` 条目本就接受已安装目录缺失的模型，但那是按部署生效的配置：每个部署都要重复声明，且该模型仍然不会出现在提供的目录中。

**在 llm-pi-ai 中新增 dsh 自有的目录叠加层。** 向 pi-ai 目录拼接条目的合并层是为依赖即将发布的数据修复维护自有代码与自有测试；补丁是更小的面积，且在上游跟进后是被删除而非继续维护。

## 后果

DeepSeek V4.1 Flash 在 `opencode-go` 路由中无需配置即可选择，而 Omen Alpha 不再出现在该目录中。补丁注册在 `@earendil-works/pi-ai@0.85.1` 上，因此后续 pi-ai 升级会以未打补丁状态安装，由守卫测试判断是否可以移除补丁。该补丁只改变模型可用集合；未变更的 Go 模型继续使用 0.85.1 原有元数据。
