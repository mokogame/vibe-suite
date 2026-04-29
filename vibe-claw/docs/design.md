# Vibe Claw MVP 设计记录

## 目标问题

实现一个独立于 Vibe IM 的智能体工程平台最小闭环，支持第三方通过 API 调用单 Agent 或固定顺序多 Agent 协作，并能追踪状态、事件、token 和审计记录。

## 参考方案

- OpenClaw：重点参考多 Agent 协作、任务路由、状态隔离和运行记录思路。
- OpenAI-compatible API：模型供应商接入保持通用接口。
- JSON Schema / contract-first：API 输入输出必须稳定、可校验。
- LangGraph / AutoGen / CrewAI：只吸收明确状态、角色分工、运行事件和失败出口，不引入早期不必要复杂度。

## 当前取舍

第一阶段选择同步执行固定顺序协作，避免一开始引入不可控动态调度器。核心模型保留 `run`、`step`、`event`、`audit`、`agent` 和 `provider`，为后续异步队列、回调、工具调用和动态调度预留边界。

## 风险

- 当前默认内存存储只适合开发和测试，生产需要 PostgreSQL 存储实现。
- Mock Provider 只用于验证编排链路，真实模型调用需要配置 OpenAI-compatible Provider。
- 当前多 Agent 协作是固定顺序模式，不是完整自主协作。

## 验证

使用 `npm run check` 同时执行 TypeScript 构建和 Vitest 回归测试。
