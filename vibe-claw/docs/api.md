# Vibe Claw API

Vibe Claw 对第三方系统提供 Bearer Token API。默认本地开发 token 是 `dev-token`，生产环境必须通过 `VIBE_CLAW_API_TOKEN` 显式配置。

## 契约入口

```bash
curl http://localhost:3100/openapi.json
```

## 创建 Agent

```bash
curl -X POST http://localhost:3100/v1/agents \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Planner",
    "instruction": "负责拆解任务"
  }'
```

## 创建多 Agent 协作 Run

```bash
curl -X POST http://localhost:3100/v1/runs \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "agentIds": ["agent_a", "agent_b"],
    "input": "设计第三方 API 调用方案",
    "context": ["必须保留审计事件"]
  }'
```

当前 MVP 使用固定顺序协作：前一个 Agent 的输出会作为下一个 Agent 的上下文输入。

## 状态事件

第三方可以通过以下接口轮询运行事件：

```bash
curl http://localhost:3100/v1/runs/{runId}/events \
  -H 'Authorization: Bearer dev-token'
```

事件包含 `queued`、`building_context`、`calling_model`、`validating_output`、`completed`、`failed` 等状态。
