# Vibe Claw API

Vibe Claw 对第三方系统提供 Bearer Token API。默认本地开发 token 是 `dev-token`，生产环境必须显式配置并通过后台或 API 创建 scoped token。

## 基础约定

```http
Authorization: Bearer <api_token>
Content-Type: application/json
```

建议所有写接口携带：

```http
Idempotency-Key: <client-generated-key>
```

错误响应统一包含：

```json
{
  "error": "Token 无效或权限不足",
  "code": "FORBIDDEN",
  "message": "Token 无效或权限不足",
  "details": {},
  "requestId": "req_xxx"
}
```

## 契约与健康

```bash
curl http://localhost:3100/openapi.json
curl http://localhost:3100/health
curl http://localhost:3100/v1/version -H 'Authorization: Bearer dev-token'
```

## Provider

创建 DeepSeek/OpenAI-compatible Provider：

```bash
curl -X POST http://localhost:3100/v1/providers \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"DeepSeek",
    "type":"openai-compatible",
    "baseUrl":"https://api.deepseek.com/v1",
    "defaultModel":"deepseek-chat",
    "apiKeyRef":"DEEPSEEK_API_KEY",
    "maxRetries":2
  }'
```

`apiKeyRef` 是环境变量或密钥引用名，不是 API key 明文。后台和列表响应只展示脱敏值。

```bash
curl http://localhost:3100/v1/providers -H 'Authorization: Bearer dev-token'
curl -X PATCH http://localhost:3100/v1/providers/{providerId} \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"status":"active"}'
```

## Agent

```bash
curl -X POST http://localhost:3100/v1/agents \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Planner",
    "instruction":"负责拆解任务",
    "defaultModel":"deepseek-chat",
    "providerId":"provider_xxx"
  }'
```

```bash
curl http://localhost:3100/v1/agents -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/agents/{agentId} -H 'Authorization: Bearer dev-token'
curl -X PATCH http://localhost:3100/v1/agents/{agentId} \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"description":"计划 Agent","status":"active"}'
curl -X POST http://localhost:3100/v1/agents/{agentId}/archive \
  -H 'Authorization: Bearer dev-token'
```

## 普通对话

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/messages \
  -H 'Authorization: Bearer dev-token' \
  -H 'Idempotency-Key: msg-001' \
  -H 'Content-Type: application/json' \
  -d '{
    "message":"你好",
    "compression":"hybrid",
    "context":[{"source":"system","content":"用中文回答","priority":40}]
  }'
```

响应会包含 `conversation`、`userMessage`、`message`、`run`、`events`、`usage`。

续聊时传入 `conversationId`：

```json
{
  "conversationId": "conv_xxx",
  "message": "继续",
  "compression": "hybrid"
}
```

## SSE 流式对话

```bash
curl -N -X POST http://localhost:3100/v1/agents/{agentId}/messages/stream \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"message":"写一个短故事","compression":"hybrid"}'
```

事件包括：

```text
status
conversation
user_message_created
run_created
delta
assistant_message_completed
done
error
```

客户端推荐策略：先本地显示用户消息和“正在思考”，再按 SSE 事件替换/追加内容；失败时在聊天流中显示错误并允许用户重试。

## 会话

```bash
curl http://localhost:3100/v1/agents/{agentId}/conversations?limit=10 \
  -H 'Authorization: Bearer dev-token'

curl http://localhost:3100/v1/conversations/{conversationId} \
  -H 'Authorization: Bearer dev-token'

curl http://localhost:3100/v1/conversations/{conversationId}/messages \
  -H 'Authorization: Bearer dev-token'
```

## 记忆

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/memories \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"type":"profile","scope":"agent","summary":"偏好","content":"用户偏好中文回答"}'
```

```bash
curl http://localhost:3100/v1/agents/{agentId}/memories \
  -H 'Authorization: Bearer dev-token'

curl -X PATCH http://localhost:3100/v1/memories/{memoryId} \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"status":"archived"}'
```

## 协议运行

注册协议：

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

运行协议：

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/protocol-runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"protocol":"vibe-example/v1","input":{"answer":"ok"}}'
```

服务端会执行输入和输出 JSON Schema 校验。输入失败返回 `400`，输出失败返回 `422`。

## Run 与队列

```bash
curl -X POST http://localhost:3100/v1/runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Idempotency-Key: run-001' \
  -H 'Content-Type: application/json' \
  -d '{
    "agentIds":["agent_a","agent_b"],
    "input":"设计第三方 API 调用方案",
    "context":[{"source":"system","content":"必须保留审计事件","priority":90}],
    "callbackUrl":"https://example.com/webhook",
    "callbackSecret":"super-secret"
  }'
```

```bash
curl http://localhost:3100/v1/runs -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/runs/{runId} -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/runs/{runId}/events -H 'Authorization: Bearer dev-token'
curl -X POST http://localhost:3100/v1/runs/{runId}/cancel -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/queue -H 'Authorization: Bearer dev-token'
```

## Token

创建 token：

```bash
curl -X POST http://localhost:3100/v1/tokens \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"reader",
    "scopes":["agents:read","runs:read"],
    "expiresAt":"2026-12-31T00:00:00.000Z",
    "allowedIps":["127.0.0.1"]
  }'
```

`plainToken` 只返回一次。

```bash
curl http://localhost:3100/v1/tokens -H 'Authorization: Bearer dev-token'
curl -X POST http://localhost:3100/v1/tokens/{tokenId}/rotate -H 'Authorization: Bearer dev-token'
curl -X POST http://localhost:3100/v1/tokens/{tokenId}/revoke -H 'Authorization: Bearer dev-token'
```

## 租约

```bash
curl -X POST http://localhost:3100/v1/agents/{agentId}/leases \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"expiresAt":"2026-12-31T00:00:00.000Z","maxCalls":10,"tokenBudget":100000,"allowedProtocols":["vibe-example/v1"]}'

curl http://localhost:3100/v1/agents/{agentId}/leases \
  -H 'Authorization: Bearer dev-token'
```

## Webhook

创建订阅：

```bash
curl -X POST http://localhost:3100/v1/webhook-subscriptions \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"prod webhook",
    "url":"https://example.com/webhook",
    "secretRef":"WEBHOOK_SECRET",
    "eventTypes":["run.completed","run.failed"]
  }'
```

```bash
curl http://localhost:3100/v1/webhook-subscriptions -H 'Authorization: Bearer dev-token'
curl -X PATCH http://localhost:3100/v1/webhook-subscriptions/{id} \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"status":"disabled"}'
curl http://localhost:3100/v1/webhook-deliveries -H 'Authorization: Bearer dev-token'
curl -X POST http://localhost:3100/v1/webhook-deliveries/{id}/replay -H 'Authorization: Bearer dev-token'
```

签名头：

```text
x-vibe-claw-signature: sha256=<hmac>
```

签名内容为原始 JSON body。

## 用量、计费、观测和审计

```bash
curl http://localhost:3100/v1/usage -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/billing -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/metrics -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/metrics/prometheus -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/audit-events -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/developer-docs -H 'Authorization: Bearer dev-token'
curl http://localhost:3100/v1/tools -H 'Authorization: Bearer dev-token'
```

## 管理员存储配置

```bash
curl http://localhost:3100/v1/admin/storage-config \
  -H 'Authorization: Bearer dev-token'

curl -X POST http://localhost:3100/v1/admin/storage-config \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"storageMode":"postgres","databaseUrl":"postgres://user:pass@localhost:5432/vibe_claw"}'
```

保存配置只写 `.env.local`，需要重启后生效。不会迁移数据。

```bash
curl -X POST http://localhost:3100/v1/admin/restart \
  -H 'Authorization: Bearer dev-token'

curl -X POST http://localhost:3100/v1/admin/reset-data \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"RESET_CURRENT_STORE"}'
```

`reset-data` 只清当前运行存储中的业务数据，不切换模式，不清 migration 状态。

## 后台入口

```bash
open http://localhost:3100/admin
```

后台核心操作也通过以上公开 API 完成。

## PostgreSQL 验证

```bash
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw npm run db:verify
```
