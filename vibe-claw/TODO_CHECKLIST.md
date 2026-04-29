# TODO Checklist

唯一交付标准：

- `docs/需求.md`
- `docs/ACCEPTANCE.md`

状态：未开始 / 开发中 / 已完成 / 已验证

## 1. 提交前代码审查

- [已验证] 检查并移除临时实现。
- [已验证] 检查重复逻辑并提取统一入口。
- [已验证] 检查命名不稳和过宽类型。
- [已验证] 补充非 happy path 测试。

## 2. 整理迁移

- [已验证] 将已追加到 `001_initial.sql` 的后续表结构拆分为 `002_*` 增量迁移。
- [已验证] 保持 `001_initial.sql` 为初始核心表。
- [已验证] 更新迁移脚本支持按顺序执行多个 migration。
- [已验证] 验证重复执行迁移安全。

## 3. OpenAPI 完整 Schema

- [已验证] 为普通对话接口补 request/response schema。
- [已验证] 为协议注册和协议运行接口补 request/response schema。
- [已验证] 为记忆接口补 request/response schema。
- [已验证] 为租约接口补 request/response schema。
- [已验证] 为后台入口或后台 API 补契约说明。
- [已验证] 为 Provider、Token、Run、Queue、Tool 补完整 schema 引用。

## 4. Provider 配置接入运行时

- [已验证] Agent 支持引用 Provider 配置。
- [已验证] Run 支持指定 Provider 配置。
- [已验证] 模型调用根据 Agent/Run Provider 配置创建运行时 provider。
- [已验证] Provider API key 通过 `apiKeyRef` 从环境变量读取，不保存明文。
- [已验证] Provider 运行时路径测试覆盖。

## 5. 可操作后台 UI

- [已验证] 后台模型配置页面可操作。
- [已验证] 后台 Agent 页面可操作。
- [已验证] 后台会话记录页面可查看。
- [已验证] 后台调用记录页面可查看。
- [已验证] 后台记忆页面可操作。
- [已验证] 后台 Token / 租约页面可操作或提供可执行表单。
- [已验证] 后台页面构建和关键操作回归。
- [已验证] 后台浏览器实测覆盖导航、概览、Agent、Run、记忆、Token、审计/队列。

## 6. 持久化队列

- [已验证] 新增持久化队列数据结构或表。
- [已验证] 创建 Run 时写入队列任务。
- [已验证] worker 从队列领取任务并执行。
- [已验证] 服务重启后恢复 queued/running 任务继续执行或安全重试。
- [已验证] 队列状态 API 返回持久化统计。
- [已验证] 持久化队列回归测试。

## 7. 最终验收

- [已验证] 所有核心流程可以跑通。
- [已验证] `npm run build` 成功。
- [已验证] `npm run lint` 无严重错误。
- [已验证] `npm run typecheck` 通过。
- [已验证] 生成 `FINAL_REPORT.md`。
- [已验证] `FINAL_REPORT.md` 列出已完成功能、修改文件、测试结果、已知问题、后续建议。
