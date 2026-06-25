# 测试与验收策略

## 目标

给架构优化提供持续回归抓手，确保“结构变了，结果没变”。

## 当前阶段要求

- `npm test` 必须覆盖 `tests/*.test.ts`
- `npm run build` 必须持续通过
- 每一轮结构优化后至少跑：
  - 全量测试
  - build
- 在当前 Windows 环境中如果 `npm` / `node` 不在 PATH，可用 Codex 捆绑 Node 直接跑：
  - `node_modules/typescript/bin/tsc --noEmit`
  - `node --test --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs tests/*.test.ts`
  - `node_modules/vite/bin/vite.js build`

## PVP 验收要求

PVP 改动需要同时覆盖单人回归和本地双人专项。默认入口仍先验单人模式，`?localPvp=1` 用于验证本地 PVP 垫层。

- 每轮 PVP 改动后至少跑 `npm test` 和 `npm run build`
- 人工验证单人模式的移动、拾取、死亡、暂停、重开和最高分没有回归
- 人工验证本地 PVP 的安全开局、输入隔离、拾取冲突、双人碰撞、胜负/平局和重开清理
- 性能验证必须包含单人 3 分钟基线和 PVP 3 分钟普通局对照
- 高风险改动需要补 PVP 高压局、长时间局和移动端横屏记录
- 详细执行表见 `docs/pvp-test-plan.md`，数据记录表见 `docs/pvp-performance-record-template.md`

## 后续补强方向

- 减少通过 `Record<string, unknown>` 直接操纵 `Game` 私有状态的测试
- 为主循环和状态快照补更稳定的测试入口
- 为文档中的关键规则补一一对应的测试说明
- `src/game/viewModel.ts` 已有纯函数测试，后续继续补主循环 system 入口测试
- `tests/localPvpRuntime.test.ts` 已覆盖本地 PVP tick、输入队列、死亡结算、冲刺节奏和 MVP 实体范围，后续继续补安全生成、同 tick 拾取冲突、重开清理和 resize 后状态一致性
- `src/game/spawnRuntime.ts`、`src/game/transientSystems.ts` 已有纯逻辑回归测试
- `src/game/snakeMovementSystem.ts` 已有纯逻辑测试，用于锁住尾巴让位、成长阻挡、拾取索引、方向 fallback、移动提交和占用表更新
- `src/game/collisionSystem.ts` 已有纯逻辑测试，用于锁住墙、自撞、黑洞、星兽碰撞结算
- `src/game/reviveSystem.ts` 已有纯逻辑测试，用于锁住死亡扣命、复活提示、倒计时完成和 game over 状态转移
- `src/game/starAttractorSystem.ts` 已有纯逻辑测试，用于锁住停用开关、吸收清空、增长增量和吸收特效生命周期
- 星兽移动现在通过 `src/game/starBeastSimulation.ts` 接入，现有 `tests/starBeast.test.ts` 继续作为集成回归护栏

## 文档同步要求

每次结构调整后，至少同步检查：

- `README.md`
- `PRODUCT_SPEC.md`
- `QA_CHECKLIST.md`
- `docs/architecture/*`
- 相关机制文档
