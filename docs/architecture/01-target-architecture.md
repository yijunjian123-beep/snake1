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

### 3. Simulation 层

建议拆成若干 system：

- `movementSystem`
- `collisionSystem`
- `foodSystem`
- `blackHoleSystem`
- `starBeastSystem`
- `starAttractorSystem`
- `reviveSystem`
- `progressionSystem`

### 4. Shared Domain 层

建议沉淀：

- 网格数学
- 方向与向量
- cell 索引
- danger zone
- 通用随机与选择器

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

## 结构约束

- 不允许把更多玩法逻辑继续塞回 `Game.ts`
- 不允许让 `render.ts` 同时继续承担状态更新和全部绘制
- 不允许在多个模块继续复制同一套网格辅助逻辑
- 所有数值常量最终都应有统一配置源
