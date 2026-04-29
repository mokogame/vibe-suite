# Assumptions

- `docs/vibe-claw.md` 中“后台管理界面”验收按当前阶段最小可运营后台入口实现：提供 `/admin` 和 `/admin/:section` 控制台入口，关键操作通过公开 API 完成并有测试覆盖。
- 协议对话采用最小 JSON Schema 子集校验，覆盖 object、required、基础类型；复杂 JSON Schema 关键字留作后续增强。
- 进程恢复机制采用启动时自动将未到达终态的 Run 标记为失败并追加事件，避免后台依赖手工改库；真正断点续跑留作队列持久化增强。
- Provider 配置保存 `apiKeyRef`，运行时模型调用仍优先使用环境变量 provider；这是为了满足 API key 不明文保存和当前 MVP 可运行性。
