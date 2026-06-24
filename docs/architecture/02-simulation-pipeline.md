# Simulation Pipeline

## 目标

把当前隐含在 `Game.ts` 里的主流程，整理成可读、可测试、可调整顺序的 pipeline。

## 建议顺序

1. 读取输入
2. 解析速度状态
3. 解析本步方向
4. 黑洞运动修正
5. 蛇本体推进
6. 碰撞结算
7. 核心拾取与成长
8. 复活/死亡阶段切换
9. 星核、星兽、黑洞等瞬态实体更新
10. 生成/补货/刷新
11. 产出快照给 UI 与 Renderer

## 本阶段要求

- 当前文档先记录目标顺序，不立即要求代码完全实现该结构
- 每个后续重构阶段都需要说明自己影响了哪一段 pipeline
- 第 9 步中的星核运动/拾取、星兽特效回收已开始迁到 `src/game/transientSystems.ts`
- 第 9 步中的星兽移动、吃核、死亡掉核、重生锁定已迁到 `src/game/starBeastSimulation.ts`
- 第 10 步中的食物 wave runtime 已由 `src/game/transientSystems.ts` 调用 `src/game/foodSpawn.ts` 执行
- 黑洞、星引仪、星兽生成编排已开始迁到 `src/game/spawnSystems.ts`
- 运行时 spawn 上下文、复活阻塞列表、布局有效性校验已迁到 `src/game/spawnRuntime.ts`
- 第 3-5 步中的蛇下一格预判、尾巴让位、自撞判断、候选方向选择、实际提交移动、占用表更新和拾取结果返回已迁到 `src/game/snakeMovementSystem.ts`
- 第 6 步中的蛇本步碰撞结算已迁到 `src/game/collisionSystem.ts`，黑洞/星兽 cell 碰撞 helper 也由这里共享
- 第 7 步中的星引仪吸收结算已迁到 `src/game/starAttractorSystem.ts`，但功能开关保持关闭，正常流程不会触发
- 第 8 步中的死亡、复活提示、复活倒计时完成、game over 状态转移已迁到 `src/game/reviveSystem.ts`
- 后续只在确有收益时继续把核心拾取后的计分、补货、UI/音效副作用从 `Game.ts` 拆成更明确的 system 边界

## 当前合理边界

- 星兽已经分为配置/生成与决策、运行时模拟、渲染和测试，不需要再把单个 AI 打分 helper 继续拆散。
- 星引仪当前是停用功能，保留 `starAttractor.ts`、`spawnSystems.ts`、`starAttractorSystem.ts`、`renderStarAttractor.ts` 这条恢复路径即可。
- 碰撞规则需要集中，因为玩家死亡、星兽死亡、生成/复活安全区都会引用相近概念，重复实现会增加规则漂移风险。
- 复活状态机已单独拆出；复活出生点选择仍由 `Game.ts` 编排，因为它依赖当前世界实体、黑洞危险区、蛇长和随机数。
