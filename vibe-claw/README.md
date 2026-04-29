# Vibe Claw

Vibe Claw 是独立的智能体工程平台，目标是支持第三方调用、多 Agent 协作和工程化治理。

当前 MVP 提供：

- Bearer Token 保护的第三方 API。
- Agent 创建、查询和运行。
- 单 Agent 与固定顺序多 Agent 协作。
- 运行状态事件、审计记录和基础 token 统计。
- Mock Provider 与 OpenAI-compatible Provider 抽象。

## 本地启动

```bash
npm install
VIBE_CLAW_API_TOKEN=dev-token npm run dev
```

默认端口是 `3100`。

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
