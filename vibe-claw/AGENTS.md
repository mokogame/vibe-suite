# Vibe Claw 协作指令

本文件作用于整个 `vibe-claw` 独立项目。

## 项目定位

Vibe Claw 是支持第三方调用、多 Agent 协作和工程化治理的智能体工程平台。它不是 Vibe IM 的子模块，也不是单 Agent 聊天工具。

## 核心纪律

- 独立边界：不得依赖 Vibe IM 的数据库、用户、会话、消息、附件、好友或群聊表。
- 成熟优先：多 Agent 协作、任务拆解、状态机、工具边界和上下文传递必须参考 OpenClaw、LangGraph、AutoGen、CrewAI、OpenAI-compatible API、JSON Schema 等成熟方案。
- API 优先：第三方调用必须通过公开 API，不能直接操纵内部状态。
- 状态明确：Agent run、step、handoff、provider call、token 和 audit event 都必须有可追踪状态。
- 审计必备：模型调用、上下文注入、记忆读取、状态变化和错误都必须可审计。
- 安全默认：API token、provider key、系统提示、开发者提示和调用日志默认按敏感资产处理。
- 复用优先：校验、状态推进、模型调用、token 统计和审计写入只能有统一入口。
- 小步验证：每次改动后优先运行 `npm run check`。

## 当前 MVP 边界

- 提供 Bearer Token 保护的第三方 API。
- 支持 Agent 创建、查询和运行。
- 支持单 Agent 与固定顺序多 Agent 协作。
- 支持运行事件、审计记录和基础 token 统计。
- 支持 mock provider 与 OpenAI-compatible provider 抽象。

暂不实现完整动态调度器、复杂工具调用、向量数据库和多租户计费。
