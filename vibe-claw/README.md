# Vibe Claw

Vibe Claw 是独立的大模型与 Agent 能力平台，目标是为第三方系统提供可复用、可审计、可治理的 SaaS/API 智能体服务。

它不是 Vibe IM 的子模块。Vibe IM 或其他业务系统只能通过 Vibe Claw 的公开 API 调用模型、Agent、对话、协议运行、记忆和运行记录能力。

## 当前能力

- Bearer Token 保护的 `/v1` API。
- Provider 管理：mock、OpenAI-compatible、DeepSeek 配置、API Key Ref 脱敏引用。
- Agent 管理：创建、查询、更新、归档、Provider 绑定、默认模型。
- 普通对话：`POST /v1/agents/{id}/messages`，保存 conversation、message、run、event 和 usage。
- SSE 流式对话：`POST /v1/agents/{id}/messages/stream`，支持状态、增量、完成和错误事件。
- 后台 Agent 对话页：历史消息、时间、附件上下文、乐观发送、正在思考、输入框自动清空、成熟滚动策略。
- 记忆系统：Agent 记忆写入、查询、状态更新和上下文注入。
- 协议运行：协议注册、JSON Schema 输入校验、模型 JSON 输出校验。
- 异步 Run：单 Agent、固定顺序多 Agent、队列、事件、取消、Webhook 回调。
- Token 生命周期：创建、列表、撤销、轮换、过期时间、IP allowlist、last used 记录、scope、tenant/project 隔离。
- Lease：Agent 调用租约，支持过期时间、调用次数、token 预算和允许协议。
- 幂等与并发：关键写接口支持 `Idempotency-Key`，同一 conversation 使用会话锁。
- 存储：memory 与 PostgreSQL 两种模式；切换不迁移、不污染；后台可配置和重置当前存储数据。
- Webhook：订阅、签名、投递日志、失败重试、dead letter 和 replay。
- 用量与计费：`/v1/usage`、`/v1/billing`。
- 观测：`/health`、`/v1/metrics`、`/v1/metrics/prometheus`、`/v1/version`、`/v1/developer-docs`、`/v1/audit-events`。
- 开发者交付：OpenAPI、开发者文档、API 版本策略、Node SDK、Python SDK。
- 后台管理：概览、模型配置、Agent 管理、调用记录、Token/租约、系统设置、开发者、审计、访问令牌弹窗、API 响应面板。

## 本地启动

```bash
npm install
VIBE_CLAW_API_TOKEN=dev-token npm run dev
```

默认端口是 `3100`。

```text
http://localhost:3100/admin
http://localhost:3100/openapi.json
```

未配置数据库时使用内存存储。内存模式适合开发和临时验证，服务重启或热更新后数据不会保留。

## PostgreSQL

推荐正式 SaaS/API 服务使用 PostgreSQL。

```bash
npm run db:setup:local
npm run dev:db
```

也可以显式指定连接串：

```bash
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw npm run db:migrate
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw VIBE_CLAW_API_TOKEN=dev-token npm run dev
```

配置 `VIBE_CLAW_DATABASE_URL` 或 `DATABASE_URL` 后，Provider、Agent、会话、记忆、运行记录、Token、Webhook、用量和审计都会写入 PostgreSQL。

存储切换规则：

- 从内存切到 PostgreSQL：只使用 PostgreSQL 已有数据，不迁移内存数据。
- 从 PostgreSQL 切到内存：使用全新内存数据，不读取数据库数据。
- 后台系统设置只保存计划配置到 `.env.local`，需要重启服务后生效。
- 数据重置只重置当前运行中的存储，不切换模式、不迁移数据。

## 常用 API

创建 Agent：

```bash
curl -X POST http://localhost:3100/v1/agents \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Planner","instruction":"负责拆解任务","defaultModel":"mock"}'
```

发送普通消息：

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/messages \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"message":"你好","compression":"hybrid"}'
```

创建异步 Run：

```bash
curl -X POST http://localhost:3100/v1/runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Idempotency-Key: job-001' \
  -H 'Content-Type: application/json' \
  -d '{"agentIds":["agent-id"],"input":"规划一个回归测试方案"}'
```

`POST /v1/runs` 返回 `202`，通过 `GET /v1/runs/{runId}` 或 `GET /v1/runs/{runId}/events` 查询执行进度。

## 回归验证

```bash
npm run typecheck
npm run build
npm test -- --run tests/api.test.ts
```

完整检查：

```bash
npm run check
```

数据库验证：

```bash
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw npm run db:verify
```

## 文档

- 产品与架构事实源：`docs/vibe-claw.md`
- 需求文档：`docs/需求文档.md`
- 验收标准：`docs/ACCEPTANCE.md`
- API 示例：`docs/api.md`
- 开发者接入：`docs/developer-api.md`
- API 版本策略：`docs/API_VERSIONING.md`
- 变更日志：`docs/CHANGELOG.md`
