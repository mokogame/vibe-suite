# Vibe Claw 设计记录

> 本文档与 `docs/vibe-claw.md`、`docs/需求文档.md` 保持一致，记录当前实现采用的主要工程取舍。更新时间：2026-04-29。

## 目标问题

实现一个独立于 Vibe IM 的智能体工程平台闭环，支持第三方通过 API 调用单 Agent、固定顺序多 Agent、普通对话、SSE 流式对话和结构化协议运行，并能追踪状态、事件、token、Webhook、用量、审计和存储状态。

## 参考方案

- OpenClaw：参考多 Agent 协作、任务路由、状态隔离和运行记录思路。
- OpenAI-compatible API / DeepSeek：模型供应商接入保持通用 HTTP Chat Completions 风格接口。
- JSON Schema / contract-first：协议输入输出必须稳定、可校验。
- LangGraph / AutoGen / CrewAI：吸收明确状态、角色分工、运行事件、失败出口和异步执行模型，不照搬复杂动态调度。
- 常见 SaaS API 平台：参考 scoped token、tenant/project 隔离、idempotency、webhook、usage、billing summary、Prometheus、OpenAPI 和 SDK 交付方式。

## 当前架构

- `api/server.ts`：HTTP API、鉴权、请求校验、运行时配置、metrics、usage、billing、admin 运维 API。
- `api/routes/*`：Provider、Agent、Token、Queue 和 Admin 路由。
- `api/openapi.ts`：公开 OpenAPI 契约。
- `api/admin-page.ts`：单页管理后台，所有操作通过公开 API 完成。
- `core/orchestrator.ts`：Run/Step 状态推进、上下文整理、provider 调用、失败和取消处理。
- `core/run-queue.ts`：Run 队列抽象；内存模式用于开发，PostgreSQL 模式支持 claim/lease、重试、退避和 dead letter。
- `core/webhooks.ts`：Run callback、Webhook subscription、投递日志、HMAC 签名、重试和 replay。
- `store/store.ts`：存储接口。
- `store/memory-store.ts`：开发和测试用内存存储。
- `store/postgres-store.ts`：正式服务使用的 PostgreSQL 存储实现。
- `model/providers.ts`：Mock Provider 与 OpenAI-compatible Provider。
- `security/tokens.ts`：Token 哈希、生成、过期、IP allowlist 和 scope 校验。
- `tools/registry.ts`：注册表式安全工具，避免任意命令执行和 Agent 自行扩权。
- `sdk/node/client.mjs`、`sdk/python/client.py`：最小开发者 SDK。

## 当前取舍

当前阶段选择“稳定 API + 可审计运行 + 固定顺序协作”的最小闭环：

- 创建 Run 后立即返回 `202`，后台队列异步推进。
- 内存模式使用进程内队列，适合开发和临时验证。
- PostgreSQL 模式使用持久化队列任务，支持 claim/lease、锁过期、重试、退避和 dead letter，适合正式 SaaS/API 基础运行。
- 多 Agent Run 按 `agentIds` 固定顺序执行，每个 Agent 输出作为下一步上下文。
- 尚不引入复杂并行 DAG、条件分支、人工审批节点和自动 handoff，避免在状态模型和权限边界未充分验证前引入不可控复杂度。

## 对话体验设计

后台聊天采用成熟聊天产品策略：

- 用户发送后立即本地显示用户气泡。
- Agent 位置立即显示“正在思考”。
- SSE 返回后只更新当前气泡，不重建整页。
- 发送成功后清空输入框和附件。
- 发送失败后恢复原输入文本，在聊天内容中显示错误。
- 滚动只在用户接近底部或自己发送时自动跟随；用户查看历史时不强制跳到底部，避免回到顶部和弹跳。

## 上下文治理

Run context 支持字符串或结构化对象：`source`、`content`、`priority`、`sensitive`。编排器按优先级和 token budget 裁剪上下文，敏感上下文不会无审计地原样传给模型 provider。

普通对话上下文来源：

- Agent instruction。
- conversation 历史消息。
- 外部 context。
- 附件文本或附件元数据。
- Agent 记忆。
- compression 策略结果。

协议运行上下文优先保留 protocol contract、input schema、output schema 和结构化输出约束。

## 审计与安全

系统记录：

- Agent 创建/更新/归档。
- Provider 创建/更新。
- Run 创建/完成/失败/取消。
- Run step 状态。
- 上下文注入。
- Provider 调用开始和完成。
- Token 创建、撤销、轮换、使用信息。
- Webhook 投递和重放。
- 存储配置、服务重启和数据重置。

安全取舍：

- Token 只保存 hash。
- 明文 token 只在创建或轮换时返回一次。
- Provider API key 只保存引用，不明文展示。
- 后台敏感字段脱敏。
- API token 绑定 scope、tenantId、projectId、过期时间和可选 IP allowlist。
- 写接口通过 `Idempotency-Key` 降低客户端重试副作用。

## 模型供应商配置

Provider 配置进入 Store 和 API 层，支持 `mock` 与 `openai-compatible` 类型、启停状态、base URL、默认模型、超时、重试和 `apiKeyRef`。DeepSeek 使用 OpenAI-compatible provider 配置接入。

`apiKeyRef` 只保存密钥引用，不保存明文 API key。当前已支持环境变量和 secret ref 风格引用；真实 Vault/KMS SDK 集成属于部署增强。

## 工具调用

当前支持 Run 输入显式声明的注册表工具调用。工具有 `inputSchema` 和 `requiredScope`，执行前根据调用者 token scope 校验。工具结果以 `tool` 来源上下文注入 Agent，并记录审计事件。

暂不支持模型自主 function calling，避免在权限、审计和工具 schema 未完善前让 Agent 自行选择外部副作用。

## 当前风险与边界

- 复杂并行 DAG、条件分支、人工审批节点和自动 handoff 尚未实现。
- 多实例全局强限额仍需集中化 quota/rate-limit 组件增强。
- 真实支付、发票、扣费和客户自助开通尚未实现。
- 真实 Vault/KMS SDK 尚未接入。
- Provider 熔断、健康路由、自动成本/延迟路由尚未实现。
- Agent 版本灰度、回滚和自动评测质量门禁尚未实现。

## 验证

推荐验证：

```bash
npm run typecheck
npm run build
npm test -- --run tests/api.test.ts
```

数据库验证：

```bash
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw npm run db:verify
```
