# Vibe Claw MVP 设计记录

## 目标问题

实现一个独立于 Vibe IM 的智能体工程平台闭环，支持第三方通过 API 调用单 Agent 或固定顺序多 Agent 协作，并能追踪状态、事件、token 和审计记录。

## 参考方案

- OpenClaw：重点参考多 Agent 协作、任务路由、状态隔离和运行记录思路。
- OpenAI-compatible API：模型供应商接入保持通用接口。
- JSON Schema / contract-first：API 输入输出必须稳定、可校验。
- LangGraph / AutoGen / CrewAI：吸收明确状态、角色分工、运行事件、失败出口和异步执行模型。

## 当前架构

- `api/server.ts`：HTTP API、鉴权、请求校验和 API 审计入口。
- `core/orchestrator.ts`：Run/Step 状态推进、上下文整理、provider 调用、失败和取消处理。
- `core/run-queue.ts`：进程内 Run 队列与并发控制，后续可替换为外部队列。
- `core/webhooks.ts`：Run 终态回调投递和 HMAC 签名。
- `store/store.ts`：存储接口。
- `store/memory-store.ts`：开发和测试用内存存储。
- `store/postgres-store.ts`：生产可用 PostgreSQL 存储实现。
- `model/providers.ts`：Mock Provider 与 OpenAI-compatible Provider。
- `model_providers` 数据模型：保存模型供应商配置、默认模型、超时、重试和密钥引用，不保存 API key 明文。
- `security/tokens.ts`：Token 哈希、生成和 scope 校验。
- `tools/registry.ts`：注册表式安全工具，避免任意命令执行和 Agent 自行扩权。

## 当前取舍

当前阶段选择异步执行固定顺序协作：创建 Run 后立即返回 `202`，进程内队列按并发限制调度执行，后台按 `agentIds` 顺序执行，每个 Agent 的输出作为下一步上下文。这样避免一开始引入不可控动态调度器，同时保留 `run`、`step`、`event`、`audit`、`agent`、`provider` 和 `store` 边界，为后续队列、回调、工具调用和动态调度预留空间。

## 上下文治理

Run context 支持字符串或结构化对象：`source`、`content`、`priority`、`sensitive`。编排器按优先级和 token budget 裁剪上下文，敏感上下文不会原样传给模型 provider。

## 审计

系统记录 Agent 创建/更新、Run 创建/完成/失败/取消、上下文注入、Provider 调用开始和完成。审计元数据避免保存完整明文 token；token 只保存 hash。

## 模型供应商配置

Provider 配置已经进入 Store 和 API 层，支持 `mock` 与 `openai-compatible` 类型、启停状态、base URL、默认模型、超时、重试和 `apiKeyRef`。`apiKeyRef` 只保存密钥引用，不保存明文 API key。当前运行时 provider 仍由环境变量创建，后续可在 Run 或 Agent 层选择 provider 配置。

## 工具调用

当前只支持 Run 输入显式声明的注册表工具调用。工具有 `inputSchema` 和 `requiredScope`，执行前根据调用者 token scope 校验。工具结果以 `tool` 来源上下文注入 Agent，并记录 `tool.call.completed` 审计事件。暂不支持模型自主 function calling，避免在权限、审计和工具 schema 未完善前让 Agent 自行选择外部副作用。

## 风险

- 当前队列仍在进程内，不是 Redis/BullMQ 或数据库队列；进程退出会中断正在执行的 Run。
- PostgreSQL store 已具备基础持久化，但还没有连接健康检查、事务化 run step 全链路和生产级索引优化。
- 当前多 Agent 协作是固定顺序模式，不是完整自主协作。
- 工具调用能力还未实现，当前只支持文本编排。

## 验证

使用 `npm run check` 同时执行 TypeScript 构建和 Vitest 回归测试。
