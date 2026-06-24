# 测试与验收策略

## 目标

给架构优化提供持续回归抓手，确保“结构变了，结果没变”。

## 当前阶段要求

- `npm test` 必须覆盖 `tests/*.test.ts`
- `npm run build` 必须持续通过
- 每一轮结构优化后至少跑：
  - 全量测试
  - build

## 后续补强方向

- 减少通过 `Record<string, any>` 直接操纵 `Game` 私有状态的测试
- 为主循环和状态快照补更稳定的测试入口
- 为文档中的关键规则补一一对应的测试说明
- 为 `src/game/viewModel.ts` 增加纯函数测试，锁定快照 / UI 派生 / ticker 派生不漂移

## 文档同步要求

每次结构调整后，至少同步检查：

- `README.md`
- `PRODUCT_SPEC.md`
- `QA_CHECKLIST.md`
- `docs/architecture/*`
- 相关机制文档
