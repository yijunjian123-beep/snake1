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
- 当前已继续落地 `collisionSystem.ts`、`reviveSystem.ts` 和 `starAttractorSystem.ts`
- 后续只在确有收益时继续把拾取后的计分、补货、UI/音效副作用改成更明确的 system 输入/输出

### 3. Simulation 层

建议拆成若干 system：

- `snakeMovementSystem`：已落地，负责蛇下一格预判、尾巴让位、自撞判断、候选方向选择、实际提交移动、占用表更新、成长扣减和拾取结果返回
- `collisionSystem`：已落地，负责墙、自身、黑洞、星兽等本步碰撞结算，并暴露跨 system 复用的 cell 碰撞 helper
- `foodSystem`：部分已落地到 `foodSpawn.ts` 和 `transientSystems.ts`
- `blackHoleSystem`：生成已进 `spawnSystems.ts`，运动影响仍由 `blackHole.ts` + `Game.ts` 编排
- `starBeastSystem`：生成已进 `spawnSystems.ts`，移动、吃核、死亡掉核和重生锁定已进 `starBeastSimulation.ts`
- `starAttractorSystem`：生成进度已进 `spawnSystems.ts`，吸收结算和吸收特效创建已进 `starAttractorSystem.ts`；当前功能开关关闭，正常流程不启用
- `reviveSystem`：复活阻塞列表已进 `spawnRuntime.ts`，死亡/复活提示/倒计时/game over 状态转移已进 `reviveSystem.ts`
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
- `renderSnake.ts`：蛇身、拖尾、速度提示和头部 cue 绘制
- `renderFx.ts`：奖励爆散和普通粒子绘制
- `renderStarBeast.ts`：星兽本体和死亡闪光绘制

`render.ts` 后续应保持 renderer 装配入口定位。墙边缘预警这类小型、单点、只被一个 pass 使用的视觉细节不需要为了行数继续拆分。

## 拆分准则

- 有完整生命周期的实体需要分：例如星兽有生成、AI、移动、死亡、掉落、渲染和测试，应该保持 `starBeast.ts`、`starBeastSimulation.ts`、`renderStarBeast.ts` 这种分层。
- 被多个系统共享的规则需要分：例如黑洞/星兽/玩家身体 cell 碰撞由 `collisionSystem.ts` 收束，避免同一判定在玩家、星兽、复活/生成逻辑里漂移。
- 关闭中的功能只保留清晰边界：星引仪当前停用，保留配置、生成编排、吸收结算和渲染模块即可，不建议继续扩散出更多空 system。
- 高频渲染热点按预算分：蛇身/拖尾已进 `renderSnake.ts`，奖励爆散和粒子已进 `renderFx.ts`；静态层和 pass 顺序继续保持稳定。
- 不按行数机械拆分：一个小函数如果只有一个调用方、没有独立测试价值、没有跨模块复用，就留在当前上下文里。

## 结构约束

- 不允许把更多玩法逻辑继续塞回 `Game.ts`
- 不允许让 `render.ts` 同时继续承担状态更新和全部绘制
- 不允许在多个模块继续复制同一套网格辅助逻辑
- 所有数值常量最终都应有统一配置源
