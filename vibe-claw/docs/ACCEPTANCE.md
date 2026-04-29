# Vibe Claw 验收标准

唯一事实源：`docs/需求文档.md` 与 `docs/vibe-claw.md`。本文档用于判断当前能力是否与文档对齐。

## 1. 服务基础

- [x] `npm run typecheck` 通过。
- [x] `npm run build` 通过。
- [x] `npm test -- --run tests/api.test.ts` 通过。
- [x] `/health` 返回服务、provider、store 和 queue 状态。
- [x] `/openapi.json` 可访问且包含核心 `/v1` API。
- [x] `/admin` 可访问并通过公开 API 获取数据。

## 2. 存储与运维

- [x] 支持内存存储。
- [x] 支持 PostgreSQL 存储。
- [x] PostgreSQL migration 覆盖当前业务表。
- [x] 后台可读取当前运行存储和计划配置。
- [x] 后台可保存存储模式到 `.env.local`。
- [x] 存储切换不做自动迁移，不污染另一种存储。
- [x] 后台可重置当前运行存储数据。
- [x] 重启和重置使用自定义确认弹窗。

## 3. Provider 与 Agent

- [x] Provider 支持创建、查询、修改。
- [x] Provider 支持 mock 与 openai-compatible。
- [x] DeepSeek 可通过 OpenAI-compatible 配置。
- [x] Provider API Key 通过引用配置，后台脱敏展示。
- [x] Agent 支持创建、查询、修改、归档。
- [x] Agent 可绑定 Provider 与默认模型。
- [x] Agent 列表表格单行省略展示。
- [x] 表单保存前执行字段校验并高亮错误字段。

## 4. 对话、SSE 与上下文

- [x] `POST /v1/agents/:id/messages` 可完成普通对话闭环。
- [x] `POST /v1/agents/:id/messages/stream` 可返回 SSE 事件。
- [x] 对话会持久化 conversation、user message、agent message、run、event 和 usage。
- [x] `GET /v1/conversations/:id` 可查询会话和消息。
- [x] `GET /v1/conversations/:id/messages` 可查询消息列表。
- [x] 支持上下文压缩策略参数。
- [x] 支持附件文本和附件元数据作为上下文发送。
- [x] 同一 conversation 写入使用锁，避免并发错乱。
- [x] 后台 Agent 对话页显示历史、时间、附件、输入框和发送。
- [x] 发送时本地乐观显示用户消息和 Agent 思考状态。
- [x] 成功后清空输入框，失败后恢复原输入。
- [x] 聊天滚动不因状态刷新回到顶部或弹跳。

## 5. 记忆与协议

- [x] Agent 记忆支持写入、查询、状态更新。
- [x] 记忆按 tenant/project/agent 隔离。
- [x] 记忆可注入模型上下文。
- [x] 后台可从 Agent 行进入记忆工作页。
- [x] Agent 协议支持注册和查询。
- [x] Protocol run 支持输入 JSON Schema 校验。
- [x] Protocol run 支持输出 JSON 解析和输出 Schema 校验。
- [x] 协议校验失败返回稳定错误结构和 issues。

## 6. Run、队列与协作

- [x] `POST /v1/runs` 创建异步 Run。
- [x] `GET /v1/runs` 查询调用记录。
- [x] `GET /v1/runs/:id` 查询详情。
- [x] `GET /v1/runs/:id/events` 查询事件。
- [x] `POST /v1/runs/:id/cancel` 支持取消。
- [x] 支持单 Agent Run。
- [x] 支持固定顺序多 Agent Run。
- [x] Queue 支持状态查询。
- [x] PostgreSQL 队列支持 claim/lease、重试、退避和 dead letter。

## 7. Token、租约、安全与幂等

- [x] API 使用 Bearer token 鉴权。
- [x] Token 支持 scope、tenantId、projectId。
- [x] Token 支持创建、列表、撤销、轮换。
- [x] Token 支持过期时间和 IP allowlist。
- [x] Token 使用记录 last used time 和 last used IP。
- [x] Token 明文只返回一次。
- [x] Token 列表不暴露 token hash 或明文。
- [x] Agent lease 支持创建和查询。
- [x] 关键写接口支持 `Idempotency-Key`。
- [x] tenant/project 资源隔离有测试覆盖。
- [x] 错误响应包含 `error`、`code`、`message`、`details`、`requestId`。

## 8. Webhook、用量、计费与观测

- [x] Run callback 支持 HMAC 签名。
- [x] Webhook subscription 支持创建、查询、更新。
- [x] Webhook delivery 支持日志查询。
- [x] Webhook delivery 支持手动 replay。
- [x] 用量统计支持 `/v1/usage`。
- [x] 计费摘要支持 `/v1/billing`。
- [x] JSON 指标支持 `/v1/metrics`。
- [x] Prometheus 指标支持 `/v1/metrics/prometheus`。
- [x] 版本信息支持 `/v1/version`。
- [x] 开发者文档索引支持 `/v1/developer-docs`。
- [x] 审计事件支持 `/v1/audit-events`。

## 9. 开发者交付

- [x] `docs/developer-api.md` 覆盖认证、错误、示例、Webhook 签名、用量、计费和 SDK。
- [x] `docs/API_VERSIONING.md` 描述 API 版本策略。
- [x] `docs/CHANGELOG.md` 记录变更。
- [x] `sdk/node/client.mjs` 提供最小 Node client。
- [x] `sdk/python/client.py` 提供最小 Python client。
- [x] `README.md` 描述当前能力和启动方式。
- [x] `docs/api.md` 覆盖核心 API 示例。
- [x] `docs/vibe-claw.md` 描述产品定位、边界、当前能力和后续增强。

## 10. 当前不纳入通过/失败的增强项

以下能力是后续增强，不阻塞当前验收：

- 复杂并行 DAG、多 Agent 条件分支、人工审批节点和自动 handoff。
- 真实 Vault/KMS SDK 集成。
- 真实支付、发票、扣费和客户自助开通。
- 多实例全局强限额服务。
- Provider 熔断、健康路由和成本/延迟自动路由。
- Agent 版本灰度、回滚和自动评测质量门禁。
