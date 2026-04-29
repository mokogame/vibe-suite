# TODO_CHECKLIST

唯一交付标准：`vibe-claw/docs/阶段性需求文档.md` 与 `vibe-claw/docs/ACCEPTANCE.md`。

## 阶段性需求拆解

- [x] Agent Contract 数据结构：新增 role、mission、boundaries、style、outputContract、toolPolicy、memoryPolicy、handoffPolicy、safetyPolicy、version。
- [x] Agent Contract API：创建/修改 Agent 可写入结构化职责契约，并保持旧 instruction 兼容。
- [x] Agent Contract 存储：memory/postgres store 均可持久化和读取 contract。
- [x] Context Builder：新增 `src/core/context-builder.ts`，统一构建 system/developer/memory/history/summary/tool/attachment/user 上下文块。
- [x] Prompt Compiler：新增 `src/core/prompt-compiler.ts`，将上下文块编译为模型 messages，不再全部塞入 system。
- [x] 记忆检索：active memory 按相关性、重要性、时间、可信度进行排序和截断，避免全量无脑注入。
- [x] 成熟对话策略：当前消息永远保留，最近历史优先，更早历史进入摘要，Agent Contract 永远保留。
- [x] 压缩与审计：上下文裁剪记录 kept/summarized/dropped，并能解释注入原因。
- [x] Provider 分层 messages：模型调用使用 system/developer/history/memory/user 等语义分层。
- [x] 工具权限治理基础：Agent Contract 可声明工具策略，Runtime 审计中记录策略上下文。
- [x] 评估回归基础：增加 Runtime 核心单元/集成测试，覆盖职责契约、上下文保留、记忆筛选、敏感脱敏、会话锁不回归。
- [x] 文档对齐：更新相关文档说明当前能力和边界。
- [x] 验收命令：`npm run build` 成功。
- [x] 验收命令：`npm run lint` 无严重错误。
- [x] 验收命令：`npm run typecheck` 通过。
- [x] 生成 `FINAL_REPORT.md`，列出已完成功能、修改文件、测试结果、已知问题、后续建议。

## 执行状态

- 当前状态：已完成全部阶段性验收项。
- 验收结果：`npm test`、`npm run build`、`npm run lint`、`npm run typecheck` 均通过。
