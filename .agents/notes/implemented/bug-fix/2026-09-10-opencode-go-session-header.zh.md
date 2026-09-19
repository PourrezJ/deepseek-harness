# Agent Note: 从 seam 会话 id 发送 opencode-go 会话头

Status: implemented

[English](2026-09-10-opencode-go-session-header.md) | 中文

## 问题

OpenCode Go 按会话路由并缓存提示词，以稳定的 `x-opencode-session` 头为键（[Where can I use it?](https://opencode.ai/docs/go/#where-can-i-use-it)）；缺少该头的请求无法被高效路由，该端点的文档还将 DeepSeek Harness 列为会话支持不完整的客户端（discussion #5495）。pi-ai 0.85.1 仅在 compat 标志指名时才把 `sessionId` 选项映射为亲和头，而 opencode-go 目录条目未设置任何此类标志，因此本仓库发出的请求均未携带该头。

## 决策

llm-pi-ai 适配器在 `opencode-go` 请求上从 seam 的 `GenerateOptions.sessionId` 派生 `x-opencode-session`。主循环、压缩与会话标题调用都标记同一会话身份，因此一次会话的所有模型请求发送同一个稳定值。部署配置的头优先生效（HTTP 头名不区分大小写），未携带会话 id 的请求不发送，Harness 归属头在命名冲突时仍然胜出。

## 已考虑的替代方案

**依赖 pi-ai 的 `sessionId` 映射。** pi-ai 仅在模型的 compat 设置 `sendSessionAffinityHeaders` 时发送 `x-session-affinity` 头族——本仓库将该字段从配置中扣留——而 opencode-go 条目未设置它，该头永远不会发出。

**通过目录数据发送该头。** `Model.headers` 是静态目录内容；按会话变化的值无法存于其中，而共享的静态 id 会把所有会话并入同一个路由桶。

**把该头留给部署配置。** 配置的 `headers` 值是静态字符串，每个部署都要重复一个无法按会话变化的值，复现并入同一桶的问题。

## 后果

`opencode-go` 请求无需任何配置即按会话路由和缓存。以其他提供者名指向 Go 端点的手声明路由不会获得该头；这类部署需自行声明静态头。一旦 pi-ai 发布版本自行把 `sessionId` 映射为 `x-opencode-session`，本派生会造成同值头重复，因此在上游覆盖该路由后应移除本派生——与目录补丁等待的是同一次评审。

## 测试

适配器规格覆盖：在 `opencode-go` 上发送、在其他提供者上缺席、大小写不敏感的部署覆盖，以及请求未指名会话时的缺席。
