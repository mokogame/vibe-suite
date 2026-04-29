# Vibe Claw Developer API

Vibe Claw exposes a stable `/v1` API for external SaaS/API integrations. Admin UI operations also use the same public API surface.

## Base URL and Auth

```http
Authorization: Bearer <api_token>
Content-Type: application/json
```

Create API tokens with `/v1/tokens` or from the admin console. The plain token is returned only once. Store it in a secret manager.

Token metadata supports:

- scopes
- tenantId/projectId isolation
- expiry
- IP allowlist
- last used time
- last used IP
- revoke
- rotate

## Idempotency

For write APIs, clients should send:

```http
Idempotency-Key: <stable-client-operation-id>
```

The same key with the same body returns the same operation result where supported. The same key with a different body returns conflict.

Use idempotency for:

- provider create/update
- agent create/update/archive
- message send
- run create
- memory write/update
- lease create
- token create/rotate/revoke
- webhook subscription changes

## Error Shape

Every `/v1/*` error response keeps the legacy `error` field and adds a stable contract:

```json
{
  "error": "Token 无效或权限不足",
  "code": "FORBIDDEN",
  "message": "Token 无效或权限不足",
  "details": {},
  "requestId": "req_xxx"
}
```

Common codes:

- `AUTH_MISSING`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `UNPROCESSABLE_ENTITY`
- `INTERNAL_ERROR`

## Core Examples

Create an Agent:

```bash
curl -s -X POST "$BASE_URL/v1/agents" \
  -H "Authorization: Bearer $VIBE_CLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Support Bot","instruction":"Answer clearly.","defaultModel":"deepseek-chat","providerId":"provider_xxx","contract":{"role":"Support Agent","mission":"Resolve customer questions clearly","style":"concise","version":"1"}}'
```

Send a message:

```bash
curl -s -X POST "$BASE_URL/v1/agents/$AGENT_ID/messages" \
  -H "Authorization: Bearer $VIBE_CLAW_TOKEN" \
  -H "Idempotency-Key: customer-message-001" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","compression":"hybrid"}'
```

Create an async run with webhook callback:

```bash
curl -s -X POST "$BASE_URL/v1/runs" \
  -H "Authorization: Bearer $VIBE_CLAW_TOKEN" \
  -H "Idempotency-Key: customer-job-001" \
  -H "Content-Type: application/json" \
  -d '{"agentIds":["agent_xxx"],"input":"process this","callbackUrl":"https://example.com/webhook","callbackSecret":"secret"}'
```

## Streaming Messages

Endpoint:

```text
POST /v1/agents/{agentId}/messages/stream
```

The response is `text/event-stream`. Current event names:

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

Recommended client behavior:

- Immediately render the local user message.
- Render an assistant placeholder such as “thinking”.
- Replace the local user message when `user_message_created` arrives.
- Append `delta` text to the assistant placeholder.
- Replace the assistant placeholder with the persisted message on `assistant_message_completed`.
- If `error` arrives, show the error in the chat stream and allow retry.
- Do not rebuild the whole message list during streaming; preserve scroll position unless the user is near the bottom.

## Conversations

Use conversations to continue context:

```text
GET /v1/agents/{agentId}/conversations?limit=10
GET /v1/conversations/{conversationId}
GET /v1/conversations/{conversationId}/messages
```

Pass `conversationId` when sending the next message.

The server serializes writes to the same conversation. Different agents, conversations, tenants and projects can run concurrently.

## Memory

```text
POST /v1/agents/{agentId}/memories
GET  /v1/agents/{agentId}/memories
PATCH /v1/memories/{memoryId}
```

Memory is scoped by tenant/project/agent. Runtime recall ranks active memories by relevance, importance, recency and confidence before injecting them into model context. Sensitive external context is redacted before reaching the provider, and each context build records kept/summarized/dropped audit metadata.

## Protocol Runs

Protocol APIs:

```text
POST /v1/agents/{agentId}/protocols
GET  /v1/agents/{agentId}/protocols
POST /v1/agents/{agentId}/protocol-runs
```

Protocol runs validate input JSON against `inputSchema`, parse model output as JSON and validate it against `outputSchema`.

## Webhook Signature

Webhook payloads are signed with HMAC SHA-256 over the raw JSON body:

```text
x-vibe-claw-signature: sha256=<hex-hmac>
```

Verify by recomputing `HMAC_SHA256(secret, raw_body)` and comparing in constant time.

Webhook subscriptions are managed with:

```text
GET   /v1/webhook-subscriptions
POST  /v1/webhook-subscriptions
PATCH /v1/webhook-subscriptions/{id}
GET   /v1/webhook-deliveries
POST  /v1/webhook-deliveries/{id}/replay
```

Supported event examples: `run.completed`, `run.failed`, `run.*`.

## Usage, Billing and Observability

- `/v1/usage` returns persisted request/token/cost counters.
- `/v1/billing` returns current plan, quota and invoice draft summary.
- `/v1/metrics` returns JSON metrics.
- `/v1/metrics/prometheus` returns Prometheus text metrics.
- `/v1/version` returns API version and compatibility information.
- `/v1/developer-docs` returns documentation links and integration index.
- `/v1/audit-events` returns audit logs.
- `x-request-id` is returned on every request and included in errors and audit logs.

## Admin Storage Configuration

Administrators can configure the runtime store from the admin console under `系统设置`, or by API:

- `GET /v1/admin/storage-config` returns configured mode, current active store type, masked database URL and restart status.
- `POST /v1/admin/storage-config` writes `.env.local` with `VIBE_CLAW_STORAGE_MODE=memory|postgres` and, for Postgres, `VIBE_CLAW_DATABASE_URL`.
- `POST /v1/admin/restart` requests process restart. Production must rely on PM2/systemd/Docker/Kubernetes/PaaS to start a new process.
- `POST /v1/admin/reset-data` resets the currently active store data only.

Storage changes intentionally require restart. The running process does not hot-swap stores because that can split writes between memory and Postgres. Memory mode is for development or temporary verification. Formal SaaS/API service should use Postgres.

Storage mode switch does not migrate data:

- memory -> postgres: load only existing Postgres data.
- postgres -> memory: start with fresh memory data.

## SDKs

Minimal SDK clients are available in:

- `sdk/node/client.mjs`
- `sdk/python/client.py`

Current SDKs intentionally stay small: request helper, Agent list/create, message send and Run create.

## Token Rotation and Network Controls

Rotate a token with:

```text
POST /v1/tokens/{id}/rotate
```

The old token is revoked and the new plain token is returned once.

Production CORS can be restricted with `VIBE_CLAW_CORS_ORIGIN` as a comma-separated allowlist. Token IP restrictions use `allowedIps` at token creation time.

## Current Production Boundaries

Implemented minimum SaaS/API closure:

- public API
- scoped token lifecycle
- tenant/project isolation
- PostgreSQL store
- idempotency
- conversation lock
- queue claim/lease
- webhook subscription and replay
- usage/billing summary
- OpenAPI and SDKs

Still future enhancements:

- complex parallel multi-agent DAG
- real payment/invoicing
- centralized global quota service
- real Vault/KMS SDK integration
- provider circuit breaker and automatic routing
- agent version rollout and evaluation gates
