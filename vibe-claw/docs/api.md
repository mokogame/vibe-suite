# Vibe Claw API

Vibe Claw 对第三方系统提供 Bearer Token API。默认本地开发 token 是 `dev-token`，生产环境必须通过 `VIBE_CLAW_API_TOKEN` 显式配置。

## 契约入口

```bash
curl http://localhost:3100/openapi.json
```

## 健康检查

```bash
curl http://localhost:3100/health
```

响应会包含当前 provider、store 健康状态和进程内 Run 队列状态。未配置数据库时使用 `memory`，配置 `VIBE_CLAW_DATABASE_URL` 或 `DATABASE_URL` 后使用 `postgres`。

## 模型供应商配置

创建 OpenAI-compatible provider 配置：

```bash
curl -X POST http://localhost:3100/v1/providers \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"DeepSeek",
    "type":"openai-compatible",
    "baseUrl":"https://api.deepseek.com/v1",
    "defaultModel":"deepseek-chat",
    "apiKeyRef":"DEEPSEEK_API_KEY"
  }'
```

`apiKeyRef` 是环境变量或密钥引用名，不是 API key 明文。当前运行时模型调用仍优先使用环境变量 provider；该配置先用于平台化治理和后续 provider 选择。

## 创建 Agent

```bash
curl -X POST http://localhost:3100/v1/agents \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Planner",
    "instruction": "负责拆解任务",
    "defaultModel": "mock"
  }'
```

## 更新或归档 Agent

```bash
curl -X PATCH http://localhost:3100/v1/agents/{agentId} \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"description":"计划 Agent","status":"active"}'
```

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/archive \
  -H 'Authorization: Bearer dev-token'
```

## 队列状态

```bash
curl http://localhost:3100/v1/queue \
  -H 'Authorization: Bearer dev-token'
```

当前队列是进程内队列，支持 `VIBE_CLAW_RUN_CONCURRENCY` 控制并发。后续可替换为 Redis/BullMQ 或数据库队列。

## 创建异步 Run

```bash
curl -X POST http://localhost:3100/v1/runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "agentIds": ["agent_a", "agent_b"],
    "input": "设计第三方 API 调用方案",
    "context": [
      {"source":"system","content":"必须保留审计事件","priority":90}
    ]
  }'
```

接口返回 `202`，表示 Run 已排队。执行在后台队列推进，第三方通过详情或事件接口查询结果。

## Webhook 回调

创建 Run 时可传入 `callbackUrl` 和可选 `callbackSecret`。Run 进入终态后，服务会向回调地址发送 `run.finished` 事件。配置 secret 时，请求头包含 `x-vibe-claw-signature: sha256=<hmac>`，签名内容为原始 JSON body。

```json
{
  "agentIds": ["agent_a"],
  "input": "规划回归测试",
  "callbackUrl": "https://example.com/webhook",
  "callbackSecret": "super-secret"
}
```

Webhook 投递结果会写入 `webhook.deliver` 审计事件。

## 查询运行详情和事件

```bash
curl http://localhost:3100/v1/runs/{runId} \
  -H 'Authorization: Bearer dev-token'
```

```bash
curl http://localhost:3100/v1/runs/{runId}/events \
  -H 'Authorization: Bearer dev-token'
```

事件包含 `queued`、`building_context`、`calling_model`、`validating_output`、`completed`、`failed`、`cancelled` 等状态。

## 取消 Run

```bash
curl -X POST http://localhost:3100/v1/runs/{runId}/cancel \
  -H 'Authorization: Bearer dev-token'
```

取消是协作式取消：系统会在步骤边界检查 Run 状态。已经完成、失败或取消的 Run 会原样返回。

## Token 管理

创建 token：

```bash
curl -X POST http://localhost:3100/v1/tokens \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"name":"reader","scopes":["agents:read","runs:read"]}'
```

响应中的 `plainToken` 只返回一次，服务端只保存 hash。

吊销 token：

```bash
curl -X POST http://localhost:3100/v1/tokens/{tokenId}/revoke \
  -H 'Authorization: Bearer dev-token'
```

## PostgreSQL 迁移

```bash
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw npm run db:migrate
```

启动服务时配置同一个 `VIBE_CLAW_DATABASE_URL` 即可启用 PostgreSQL 存储。

## 工具调用

查询当前允许调用的工具：

```bash
curl http://localhost:3100/v1/tools \
  -H 'Authorization: Bearer dev-token'
```

Run 创建时可以显式声明工具调用，工具结果会作为 `tool` 来源上下文注入 Agent，并写入审计事件：

```bash
curl -X POST http://localhost:3100/v1/runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "agentIds": ["agent_a"],
    "input": "总结工具结果",
    "toolCalls": [
      {"name":"text.echo","input":{"text":"工具数据"}}
    ]
  }'
```

当前只开放注册表内安全工具，避免 Agent 自行扩权或执行任意系统命令。工具具备 `inputSchema` 和 `requiredScope`，调用方 token 必须拥有对应 scope，例如 `tools:text` 或 `tools:*`。

## 普通对话

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/messages \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"message":"你好","compression":"hybrid"}'
```

接口会创建或复用 conversation，写入用户消息和 Agent 回复，并返回 run、events、usage。

## 记忆管理

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/memories \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"type":"profile","scope":"agent","summary":"偏好","content":"用户偏好中文回答"}'
```

```bash
curl http://localhost:3100/v1/agents/{agentId}/memories \
  -H 'Authorization: Bearer dev-token'
```

```bash
curl -X PATCH http://localhost:3100/v1/memories/{memoryId} \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"status":"archived"}'
```

## 协议对话

先注册协议：

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/protocols \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"vibe-example",
    "version":"v1",
    "inputSchema":{"type":"object","required":["answer"],"properties":{"answer":{"type":"string"}}},
    "outputSchema":{"type":"object","required":["answer"],"properties":{"answer":{"type":"string"}}}
  }'
```

再运行协议：

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/protocol-runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"protocol":"vibe-example/v1","input":{"answer":"ok"}}'
```

服务端会执行最小 JSON Schema 校验。校验失败返回 `valid:false` 和 `issues`。

## 租约

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/leases \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"expiresAt":"2026-12-31T00:00:00.000Z","maxCalls":10,"tokenBudget":100000,"allowedProtocols":["vibe-example/v1"]}'
```

租约可限制过期时间、调用次数、token 预算和允许协议范围。租约不能修改 Agent 全局配置。

## 后台入口

```bash
curl http://localhost:3100/admin
```

当前提供轻量控制台入口，核心操作仍通过公开 API 完成。

## PostgreSQL 验证

配置数据库后可执行完整数据库验证：

```bash
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw npm run db:verify
```

该命令会按顺序执行迁移、执行健康检查，并验证 Agent、Run、Event、Provider、Memory 的最小读写闭环。未配置数据库连接时命令会跳过，不影响本地内存模式回归。
