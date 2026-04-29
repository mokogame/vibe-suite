# TODO_CHECKLIST

唯一交付标准：`vibe-claw/docs/需求文档.md` 与 `vibe-claw/docs/ACCEPTANCE.md`。

## 需求拆解

- [x] 外部开发者文档：认证、错误码、示例、SDK 调用、Webhook 签名校验说明。
- [x] 版本化 API 策略：提供版本信息、兼容策略、弃用策略、变更日志。
- [x] 稳定错误码体系：错误响应包含 `code`、`message`、`details`、`requestId`，并保持旧 `error` 字段兼容。
- [x] API Key 生命周期运营：创建后只返回一次明文；支持轮换、过期时间、最后使用时间、最后使用 IP、IP allowlist、撤销。
- [x] 持久化限流/用量统计：将请求数、token、成本按窗口写入 store，支持查询。
- [x] 计费/套餐/账单：提供 tenant 级套餐、额度和当前用量摘要 API。
- [x] 开发者控制台：后台增加文档、用量、Webhook、版本信息入口。
- [x] Webhook 订阅管理：支持统一 webhook endpoint 配置、事件类型订阅、启停和投递时复用订阅。
- [x] SLA/可观测性：提供 Prometheus 文本指标、基础错误聚合摘要、requestId 链路字段。
- [x] 多实例生产部署能力：用数据库用量聚合、队列 claim/lease、会话锁和幂等记录形成多实例安全边界。
- [x] 安全增强：密钥引用、IP allowlist、CORS 配置、审计事件、Webhook 签名和脱敏说明。
- [x] SDK：提供 Node/Python 最小 client 示例。
- [x] API 契约测试：OpenAPI 与核心接口响应字段保持一致。

## 验收项

- [x] `docs/需求文档.md` 中所有功能均已实现或以可运行最小闭环交付。
- [x] 页面、接口、组件、数据结构均按文档完成。
- [x] 所有核心流程可以跑通。
- [x] `npm run build` 成功。
- [x] `npm run lint` 无严重错误。
- [x] `npm run typecheck` 通过。
- [x] 已生成 `FINAL_REPORT.md`。
- [x] `FINAL_REPORT.md` 列出已完成功能、修改文件、测试结果、已知问题、后续建议。

## 当前进度

- 状态：已完成。
- 最后验证时间：2026-04-29。

## 文档对齐

- [x] `README.md`、`docs/vibe-claw.md`、`docs/需求文档.md`、`docs/ACCEPTANCE.md`、`docs/api.md`、`docs/developer-api.md` 已按当前实现能力对齐。
