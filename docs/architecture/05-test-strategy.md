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

## 后续补强方向

- 减少通过 `Record<string, unknown>` 直接操纵 `Game` 私有状态的测试
- 为主循环和状态快照补更稳定的测试入口
- 为文档中的关键规则补一一对应的测试说明
- `src/game/viewModel.ts` 已有纯函数测试，后续继续补主循环 system 入口测试
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
