---
description: "通过 SessionController 监督既有 DeepSeek Harness 会话的回环 Streamable HTTP MCP 控制面，面向经认证的 Secure Tunnel 访问。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-harness-supervisor-mcp

[English](README.md) | 中文

## 概述

本包在宿主现有的 `SessionController` 之上暴露一个刻意收窄的 MCP 控制面。经认证的外部监督者可以列出 Harness 会话、读取有界的近期快照、向既有会话排队或 steer 一条提示、取消当前 turn，以及等待会话进入空闲状态。它不会创建会话、暴露文件系统或 shell，也不会绕过 Harness 的会话所有权。HTTP 监听器只绑定 `127.0.0.1`；需要远程访问时，应在该回环端点前放置经认证的 tunnel，而不是直接公开端口。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

只在确实需要被监督的宿主 profile 中挂载本包。典型本地组合使用端口 `31977` 与路径 `/mcp`；服务自身始终绑定回环地址。

```yaml
- id: harness-supervisor-mcp
  name: '@deepseek-ai/dsh-host-harness-supervisor-mcp'
  config:
    port: 31977
    path: /mcp
```

让经认证的 tunnel runtime 指向 `http://127.0.0.1:31977/mcp`。不要用公开 Web UI 端口或把 MCP 监听器绑定到 `0.0.0.0` 来替代 tunnel 认证。

### 工具面

服务器发布五个工具。`harness_list_sessions` 返回近期会话摘要；`harness_session_snapshot` 返回一个会话中有界的持久事件；`harness_prompt_session` 通过 `SessionController.prompt` 以 `queue` 或 `steer` 模式发送文本；`harness_cancel_session` 请求取消当前 turn；`harness_wait_session` 轮询运行状态，直到会话结束或达到调用方超时，然后返回近期快照。

### 结果与传输边界

序列化前会限制单个字符串和数组大小，并把每个文本工具结果限制在 64 KiB UTF-8 内。如果完整 JSON 超过上限，服务会返回一个截断 envelope，其中包含原始字节数与 UTF-8 安全的预览。请求只在配置的精确路径上被接受，并且必须通过 localhost Host 与 Origin 校验。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

本包是适配器，而不是第二套 agent runtime。所有操作都委托给组合中的 `SessionController`，因此提示、取消、检查和运行状态沿用普通 Harness 宿主的所有权与持久化规则。MCP 服务器不会自行构造编码 agent，也不会打开直接的文件系统或进程控制通道。

### 生命周期与安全边界

`HarnessSupervisorMcp` 拥有一个绑定在 `127.0.0.1` 的 Node HTTP 监听器和一个 Streamable HTTP MCP handler。Cordis dispose 时先关闭监听器与活动连接，再关闭 MCP handler。包会在协议分发前验证精确请求路径，并在把请求交给协议服务器前应用 MCP SDK 的 localhost Host 与 Origin 防护。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis 服务、回环 HTTP 生命周期、MCP 工具注册与有界结果投影 |
| [`tests/supervisor-mcp.spec.ts`](tests/supervisor-mcp.spec.ts) | 工具、字节上限、Host/Origin 拒绝与 dispose 的真实 HTTP MCP 组合测试 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session Controller](../../api/session-controller/README.zh.md) — 本适配器委托到的宿主会话所有权与方法。
- [Host 包映射](../README.zh.md) — 本可选服务在 Web Host 包中的位置。
- [Web app bundle](../../bundle/web-app/README.zh.md) — 可携带此包、并由用户 profile 决定是否挂载的 bundle。

-----

<a id="model-experience"></a>
## 模型体验

### MCP 监督工具

#### 模型看到什么

监督侧 MCP 客户端会看到五个 `harness_*` 工具名、描述、已校验参数，以及有界 JSON 文本结果。被监督的 Harness 模型不会看到 list、snapshot、cancel 或 wait 流量；只有通过 `harness_prompt_session` 明确发送的文本，才会经 `SessionController.prompt` 作为普通用户消息进入该 Harness 会话。

#### Token 影响

工具定义和返回 JSON 会占用监督模型的上下文。在被监督的 Harness 会话中，只有被接受的 `harness_prompt_session` 消息会增加持久用户消息 token；只读检查不会把结果复制回 Harness 模型上下文。

#### KV Cache 影响

监督读取不会改变 Harness 模型前缀。排队的监督提示会追加一个普通用户 turn，并且在所选路由保持兼容时可以复用现有 Harness 前缀；`steer` 请求遵循 `SessionController` 所拥有的 active-turn 语义，而不会创建平行的 cache lineage。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下约束是 supervisor 控制面的刻意边界。

- **仅既有会话** — 不提供创建会话工具；调用方必须选择 Harness 宿主已经拥有的会话。
- **仅文本监督** — `harness_prompt_session` 接受文本，不注入附件或任意 Session 事件。
- **有界可观测性** — snapshot 与 list 结果会刻意截断，它不是批量 transcript 导出 API。
- **Tunnel 认证位于包外** — 本服务只提供回环端点；部署认证与远程可达性由选定的 secure tunnel runtime 负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

保持本包足够窄：监督应继续流经 `SessionController`，新增工具不应演变成通用 shell、文件系统或创建会话的后门。

</details>
