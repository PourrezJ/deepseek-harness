# Agent Note: 为 deepseek-v4.1-flash 打补丁修正 pi-ai 生成的 opencode-go 目录

Status: implemented

[English](2026-09-10-pi-ai-opencode-go-catalog-patch.md) | 中文

## 问题

OpenCode Go 在其端点上新增了 DeepSeek V4.1 Flash（`deepseek-v4.1-flash`）（[端点列表](https://opencode.ai/docs/go/#endpoints)），models.dev 也已收录该条目，但 `@earendil-works/pi-ai@0.85.1` 在 2026-09-05 生成了它的目录数据，早于上游注册该模型的时间。`opencode-go` 路由的模型列表直接来自该生成目录，因此该模型在此前不出现在 harness 提供的任何选择器中。

## 决策

一个 [pnpm 补丁](../../../../patches/@earendil-works__pi-ai@0.85.1.patch) 向已安装包的 `dist/providers/data/opencode-go.json` 添加扁平化的 `deepseek-v4.1-flash` 条目，数据取自 models.dev，并与已发布的 `deepseek-v4-flash-vision-exp` 条目保持一致：`https://opencode.ai/zen/go/v1` 上的 `openai-completions`，文本与图像输入，1,000,000 令牌上下文窗口，384,000 令牌输出上限，DeepSeek compat 块，以及 low、high、max 思考级别。一个[目录规格测试](../../../../packages/llm/llm-pi-ai/tests/catalog.spec.ts)在无配置的情况下服务该路由，并在条目缺失时失败并指名该补丁。[pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) 在补丁注册处写明移除条件。

## 已考虑的替代方案

**升级 pi-ai。** 0.85.1 是最新发布版本；没有任何已发布版本携带该模型。

**在 settings 配置中声明该模型。** 目录路由上的 `models` 条目本就接受已安装目录缺失的模型，但那是按部署生效的配置：每个部署都要重复声明，且该模型仍然不会出现在提供的目录中。

**在 llm-pi-ai 中新增 dsh 自有的目录叠加层。** 向 pi-ai 目录拼接条目的合并层是为依赖即将发布的数据修复维护自有代码与自有测试；补丁是更小的面积，且在上游跟进后是被删除而非继续维护。

## 后果

该模型随 `opencode-go` 路由处处可选，无需任何配置。补丁注册在 `@earendil-works/pi-ai@0.85.1` 上，因此后续 pi-ai 升级会以未打补丁状态安装，由守卫测试裁决：上游目录一旦自带该模型即通过，缺失时则失败并指名需要重新应用或移除的补丁。补丁中的成本数值可能随 models.dev 更新而漂移；harness 从不读取 pi-ai 的成本元数据，该漂移无实际影响。
