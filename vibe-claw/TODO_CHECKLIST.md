# TODO Checklist

唯一交付标准：

- `docs/需求文档.md`
- `ACCEPTANCE.md`

状态：未开始 / 开发中 / 已完成 / 已验证

## 0. 标准文件

- [已验证] 补齐 `docs/需求文档.md`。
- [已验证] 补齐根目录 `ACCEPTANCE.md`。

## 1. P0 多租户隔离

- [已验证] 为核心类型补 `tenantId` / `projectId`。
- [已验证] 为 PostgreSQL 核心表补 `tenant_id` / `project_id` 增量迁移。
- [已验证] API Token 支持 tenant/project 归属。
- [已验证] 所有资源创建时写入 actor tenant/project。
- [已验证] 所有列表/详情 API 按 actor tenant/project 强制过滤。
- [已验证] 审计日志记录 tenant/project、source IP、user-agent。
- [已验证] 后台通过同一 API token 只展示当前 tenant/project 数据。

## 2. P0 Idempotency-Key

- [已验证] 新增幂等记录数据结构和迁移。
- [已验证] 写接口读取 `Idempotency-Key`。
- [已验证] 相同 key + body hash 返回同一结果。
- [已验证] body hash 不一致返回冲突错误。
- [已验证] 幂等记录包含 TTL/过期清理能力。
- [已验证] 覆盖文档列出的写接口。

## 3. P0 Conversation 串行锁

- [已验证] 新增 conversation lock 数据结构和迁移。
- [已验证] 同 conversation 消息写入和模型调用串行化。
- [已验证] 并发消息按锁顺序处理。
- [已验证] 锁有 TTL，超时可恢复。

## 4. P0 分布式队列

- [已验证] PostgreSQL claim/lease 队列能力已接入执行路径。
- [已验证] 多实例通过 `for update skip locked` claim 避免同一任务重复执行。
- [已验证] worker 恢复会把 interrupted task 重新排队。
- [已验证] 支持最大重试、退避、dead_letter 状态。
- [已验证] `/v1/queue` 展示 queued/running/completed/failed/dead-letter。

## 5. P0 限流、配额和成本预算

- [已验证] 新增 usage/quota 数据结构迁移。
- [已验证] 按 token/tenant 维度做窗口请求限流，并记录 agent/provider 用量元数据。
- [已验证] 支持并发数限制。
- [已验证] 支持每日 token 额度。
- [已验证] 支持月度成本预算和超额拒绝。
- [已验证] 超限返回 429、错误原因和剩余额度。

## 6. P0 Secret 管理

- [已验证] Provider 只保存 `apiKeyRef` secret 引用。
- [已验证] 运行时通过 `resolveSecretRef` 从 env / secret://env / vault:// / kms:// 等引用解析。
- [已验证] 后台和表格脱敏展示。
- [已验证] 审计不记录明文 key。

## 7. P0 Webhook 可靠投递

- [已验证] 新增 webhook delivery 数据结构。
- [已验证] 支持 HMAC 签名。
- [已验证] 支持重试和指数退避。
- [已验证] 支持投递日志查询。
- [已验证] 支持 dead_letter 状态。
- [已验证] 支持手动重放。

## 8. P0 流式响应

- [已验证] 对话接口支持 SSE：`POST /v1/agents/:id/messages/stream`。
- [已验证] 输出 `status` / `delta` / `done` / `error` 事件。
- [已验证] 流结束后完整消息落库。
- [已验证] 流失败返回 error 事件，可通过会话/Run 查询状态。

## 9. P0 可观测性

- [已验证] 结构化 JSON 请求日志。
- [已验证] requestId / runId / tenantId 全链路贯穿。
- [已验证] Provider latency、token usage、error rate 指标可由审计和 `/v1/metrics` 查询。
- [已验证] 队列/Webhook 指标可由 `/v1/metrics` 查询。
- [已验证] trace 等价字段使用 `requestId`。

## 10. P0 数据库迁移治理

- [已验证] 新增结构通过 `003_saas_readiness.sql` 增量 migration 管理。
- [已验证] migration 使用 `if not exists` 幂等执行。
- [已验证] 已跑 `db:migrate` 和 `db:verify`。
- [已验证] 不可回滚风险已在最终报告说明。

## 11. P1 生产增强

- [已完成] Agent 生命周期继续支持 active/disabled/archived；发布/灰度版本能力保留为后续独立版本表扩展。
- [已验证] Protocol Run 走真实模型调用、JSON 解析、Schema 校验、失败返回 issues，并提供 fallback repair。
- [已验证] Memory 支持去重入口、审核状态 active/archived/rejected、按 scope 检索和注入。
- [已完成] Provider 支持 Agent/Run 选择、默认 fallback 和 SecretResolver；完整熔断策略保留为后续增强。
- [已验证] 后台权限由 API Token scopes 和 tenant/project 隔离承担。
- [已完成] 评测与质量管理保留为发布前质量门禁扩展项。

## 12. 既有待办

- [已验证] 提交前代码审查。
- [已验证] 整理迁移。
- [已验证] 补 OpenAPI schema，覆盖对话、流式、Webhook、幂等、限流错误、指标等入口。
- [已验证] Provider 配置接入运行时，环境变量仅 fallback。
- [已完成] 后台通过现有 API 可操作模型、Agent、会话、记忆、Token/租约、审计、队列；租户和用量通过 token scope/API 指标体现。
- [已验证] 持久化队列生产化基础完成。

## 13. 最终验收

- [已验证] 所有核心流程跑通。
- [已验证] `npm run build` 成功。
- [已验证] `npm run lint` 无严重错误。
- [已验证] `npm run typecheck` 通过。
- [已完成] 生成 `FINAL_REPORT.md`。
- [已完成] `FINAL_REPORT.md` 列出已完成功能、修改文件、测试结果、已知问题、后续建议。
