# Vibe Claw Acceptance

当前验收事实源已统一到：

- `docs/需求文档.md`
- `docs/ACCEPTANCE.md`
- `docs/vibe-claw.md`

本文件仅保留根目录入口，避免与 `docs/ACCEPTANCE.md` 形成第二事实源。

当前验收结论：Vibe Claw 已具备正式对外 SaaS/API 服务的最小闭环能力，后续复杂多 Agent DAG、真实支付、Vault/KMS SDK、全局强限额和 Agent 版本灰度属于增强项，不阻塞当前验收。

必跑验证：

```bash
npm run typecheck
npm run build
npm test -- --run tests/api.test.ts
```
