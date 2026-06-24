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
- 第 3-5 步中的蛇下一格预判、尾巴让位、自撞判断、候选方向选择已迁到 `src/game/snakeMovementSystem.ts`
- 后续继续把蛇移动提交、碰撞结算、复活状态机从 `Game.ts` 拆成更明确的 system 边界
