# Vibe Claw

Vibe Claw 是独立的智能体工程平台，目标是支持第三方调用、多 Agent 协作和工程化治理。

当前 MVP 提供：

- Bearer Token 保护的第三方 API。
- Agent 创建、查询、更新、归档。
- 异步 Run 创建、进程内队列、详情查询、事件轮询、Webhook 回调和取消。
- 单 Agent 与固定顺序多 Agent 协作。
- 运行状态事件、审计记录和基础 token 统计。
- API Token 创建、scope 校验和吊销。
- Memory Store 与 PostgreSQL Store 两种存储实现。
- Mock Provider 与 OpenAI-compatible Provider 抽象，支持超时、重试和错误归一。
- 模型供应商配置管理，保存密钥引用而非 API key 明文。
- 注册表式工具调用，具备输入 schema、scope 权限、上下文注入和审计。

## 本地启动

```bash
npm install
VIBE_CLAW_API_TOKEN=dev-token npm run dev
```

默认端口是 `3100`。未配置数据库时使用内存存储。

## PostgreSQL

```bash
# 自动创建本机 vibe_claw 数据库并执行迁移
npm run db:setup:local

# 使用 PostgreSQL 持久化启动开发服务
npm run dev:db
```

也可以显式指定连接串：

```bash
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw npm run db:migrate
VIBE_CLAW_DATABASE_URL=postgres://user:pass@localhost:5432/vibe_claw VIBE_CLAW_API_TOKEN=dev-token npm run dev
```

配置 `VIBE_CLAW_DATABASE_URL` 或 `DATABASE_URL` 后，Provider、Agent、会话、记忆、运行记录都会写入 PostgreSQL；否则会退回内存存储，重启或热更新后数据不会保留。

## 回归验证

```bash
npm run check
```

## API 示例

```bash
curl -X POST http://localhost:3100/v1/agents \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Planner","instruction":"负责拆解任务"}'
```

```bash
curl -X POST http://localhost:3100/v1/runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"agentIds":["agent-id"],"input":"规划一个回归测试方案"}'
```

`POST /v1/runs` 返回 `202`，表示 Run 已排队。通过 `GET /v1/runs/{runId}` 或 `GET /v1/runs/{runId}/events` 查询执行进度。
