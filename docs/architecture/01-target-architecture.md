# 目标架构

## 总目标

在不改变功能、表现、手感的前提下，把当前实现收敛成一个更适合继续扩展和做性能优化的结构。

## 目标分层

### 1. App 启动层

- `main.ts`
- 只负责挂载 DOM、创建运行对象、处理页面级生命周期

### 2. Runtime 编排层

- `Game.ts`
- 重构后应只负责：
  - 生命周期
  - 时钟推进
  - 输入接入
  - 调用 simulation pipeline
  - 调用 renderer
  - 驱动 UI 同步
- 当前过渡阶段已把部分 runtime 状态收束为 `lifecycle`、`movement`、`timing`、`speedRuntime`、`entities`、`progress`、`spawn`、`inputState`，后续会继续向 systems 化拆分推进
- `src/game/stateFactory.ts` 负责这批状态的默认初始化，目标是让 `Game.ts` 只保留编排和生命周期调用
- 当前已落地 `simulationPipeline.ts`、`spawnSystems.ts`、`spawnRuntime.ts`、`transientSystems.ts`、`starBeastSimulation.ts`、`snakeMovementSystem.ts`
- 后续继续把蛇移动提交、碰撞结算、复活状态机等流程改成显式 system 输入/输出

### 3. Simulation 层

建议拆成若干 system：

- `snakeMovementSystem`：已部分落地，负责蛇下一格预判、尾巴让位、自撞判断、候选方向选择；后续再承接提交移动
- `collisionSystem`：待拆，负责墙、自身、黑洞、星兽等碰撞结算
- `foodSystem`：部分已落地到 `foodSpawn.ts` 和 `transientSystems.ts`
- `blackHoleSystem`：生成已进 `spawnSystems.ts`，运动影响仍由 `blackHole.ts` + `Game.ts` 编排
- `starBeastSystem`：生成已进 `spawnSystems.ts`，移动、吃核、死亡掉核和重生锁定已进 `starBeastSimulation.ts`
- `starAttractorSystem`：生成进度已进 `spawnSystems.ts`，吸收结算仍在 `Game.ts`
- `reviveSystem`：复活阻塞列表已进 `spawnRuntime.ts`，复活状态机仍待拆
- `progressionSystem`：当前由 `progression.ts` 提供配置和派生
- `spawnSystem`：已落地为 `spawnSelectors.ts` + `spawnRuntime.ts` + `spawnSystems.ts`

### 4. Shared Domain 层

建议沉淀：

- 网格数学
- 方向与向量
- cell 索引
- danger zone
- 通用随机与选择器
- 当前 `src/game/foodSpawn.ts` 已经开始承接食物生成占用收集、波次袋、聚类权重与黑洞避让
- 当前 `src/game/spawnSelectors.ts` 负责共享 cell 派生，避免各 system 重复拼星核/星兽/星引仪占用列表
- 当前 `src/game/spawnRuntime.ts` 负责把运行时实体状态转成 spawn / revive / placement 校验需要的纯输入

### 5. View Model / Selector 层

- 给 UI 和 Renderer 提供稳定快照
- 避免它们直接耦合 `Game` 的内部字段布局
- 当前第一步已经落地为 `src/game/viewModel.ts`，负责快照、ticker 和 UI 派生数据的构建与应用
- 后续如果继续拆分，优先把更多纯派生逻辑从 `Game.ts` 和 `render.ts` 迁到这里或更细的 selector 模块

### 6. Render Pipeline 层

建议拆分成：

- 渲染状态更新
- 画质策略
- 静态层缓存
- 动态实体绘制 pass
- 覆盖层与特效 pass

当前已落地：

- `renderQuality.ts`：画质策略
- `renderState.ts`：渲染状态更新
- `renderOverlay.ts`：覆盖层绘制
- `renderPasses.ts`：单帧 pass 编排
- `renderStaticLayers.ts`：静态层缓存和 backing store 管理
- `renderBlackHole.ts`：黑洞本体和黑洞 cue 绘制
- `renderStarBeast.ts`：星兽本体和死亡闪光绘制

后续继续把 `render.ts` 里的低层绘制函数拆到 background/entity/fx 模块。

## 结构约束

- 不允许把更多玩法逻辑继续塞回 `Game.ts`
- 不允许让 `render.ts` 同时继续承担状态更新和全部绘制
- 不允许在多个模块继续复制同一套网格辅助逻辑
- 所有数值常量最终都应有统一配置源
