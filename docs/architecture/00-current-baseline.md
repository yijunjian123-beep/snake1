# 当前基线

## 目标

这份文档用于冻结重构前的真实现状，后续所有架构优化都必须以这里为基线，不得擅自改变玩法、表现和手感。

## 当前代码结构

- `src/main.ts`
  - 负责查询 DOM、组装 `GameUiElements`、启动 `Game`
- `src/game/Game.ts`
  - 当前运行时总控
  - 同时负责生命周期、输入处理、移动推进、碰撞、生成、复活、UI 同步
- `src/game/render.ts`
  - 当前渲染总控
  - 同时负责背景、棋盘、实体绘制、粒子、拖尾、覆盖层、画质降级
- `src/game/input.ts`
  - 键盘与触控输入适配
- `src/game/audio.ts`
  - 音效控制
- `src/game/storage.ts`
  - 本地最高分读写
- `src/game/blackHole.ts`
  - 黑洞配置、生成、影响判定与运动解析
- `src/game/spawn.ts`
  - 安全出生、复活出生辅助
- `src/game/foodSpawn.ts`
  - 食物生成占用收集、波次、聚类与黑洞避让的抽离层
- `src/game/spawnSelectors.ts`
  - 星核、星兽、星引仪、黑洞生成阻塞区等共享 spawn 派生数据
- `src/game/spawnRuntime.ts`
  - 运行时 spawn 上下文、复活阻塞列表、resize 后布局有效性校验
- `src/game/spawnSystems.ts`
  - 星引仪、黑洞、星兽的生成编排 system，直接操作 `SpawnRuntimeState`
- `src/game/transientSystems.ts`
  - 食物波、星核运动/拾取、星兽死亡特效回收等瞬态更新 system
- `src/game/simulationPipeline.ts`
  - 当前主循环中瞬态更新阶段的第一层 pipeline 入口
- `src/game/starBeastSimulation.ts`
  - 星兽出生 grace、移动、AI 决策、吃星核、死亡掉核、重生锁定等模拟 system
- `src/game/snakeMovementSystem.ts`
  - 蛇下一格预判、尾巴让位、自撞判定、候选方向选择等移动前置纯逻辑
- `src/game/starBeast.ts`
  - 星兽生成、AI 倾向、掉核
- `src/game/starAttractor.ts`
  - 星引仪相关配置与生成逻辑
- `src/game/progression.ts`
  - 解锁条件、安全出生默认配置、长度提示文案
- `src/game/viewModel.ts`
  - 当前快照、ticker、UI 派生与 UI 缓存应用的抽离层
- `src/game/renderState.ts`
  - 粒子、拖尾、震屏、奖励爆散、黑洞预警透明度等渲染运行时状态
- `src/game/renderQuality.ts`
  - 画质级别、帧时间采样与自动降级策略
- `src/game/renderPasses.ts`
  - 单帧渲染 pass 编排：背景、震屏实体、奖励、特效、覆盖层、粒子
- `src/game/renderStaticLayers.ts`
  - 背景层和棋盘层的离屏 canvas、DPR backing store、dirty/cache 管理
- `src/game/renderOverlay.ts`
  - 暂停、死亡、复活倒计时、黑洞顶部预警等覆盖层绘制
- `src/game/renderCanvasUtils.ts`
  - Canvas 通用工具：尺寸测量、插值、缓动、确定性随机、cell 中心点、圆角矩形、亮度/透明度 clamp
- `src/game/renderBackground.ts`
  - 背景星空、星云、星尘、静态背景绘制和动态星点绘制
- `src/game/renderBoard.ts`
  - 霓虹远景网格、核心背景光、棋盘边框/格线和静态棋盘快照
- `src/game/renderCores.ts`
  - 食物星核、掉落星核、星核爆散入场状态和共享星形 glyph 指标
- `src/game/renderBlackHole.ts`
  - 黑洞本体绘制与黑洞 cue 绘制
- `src/game/renderStarBeast.ts`
  - 星兽本体绘制与星兽死亡闪光绘制
- `src/game/renderStarAttractor.ts`
  - 星引仪本体与吸收流光特效绘制

## 当前已确认的实现形态

- `Game.ts` 仍然是主要运行时入口，但已从约 2300 行继续瘦身到约 1700 行
- `render.ts` 仍然是主要低层绘制入口，但 pass 编排、渲染状态、画质、覆盖层、背景层、棋盘层已经开始拆出，黑洞与星兽实体绘制也已继续下沉
- 黑洞、星兽、出生算法已有独立模块；生成编排已开始集中到 `spawnSystems.ts` 和 `spawnRuntime.ts`
- `Game.ts` 的运行时状态已开始收束成几个域对象：
  - `lifecycle`
  - `movement`
  - `timing`
  - `speedRuntime`
  - `entities`
  - `progress`
  - `spawn`
  - `inputState`
- `src/game/stateFactory.ts` 已开始承接运行时状态初始化，避免 `Game.ts` 手工拼默认对象
- `src/game/viewModel.ts` 已开始承接快照、UI 派生和 ticker 派生，`Game.ts` 不再内联拼装这部分纯逻辑
- `src/game/foodSpawn.ts` 已开始承接食物生成与 wave bag 逻辑，`Game.ts` 里只保留流程调用
- `src/game/spawnRuntime.ts` 已承接食物生成上下文、复活阻塞列表和 resize 布局合法性校验
- `src/game/transientSystems.ts` 已承接食物波、星核运动/拾取、星兽特效回收，`Game.ts` 通过薄调用接入
- `src/game/simulationPipeline.ts` 已开始承接第 9-10 步之间的瞬态更新顺序
- `src/game/starBeastSimulation.ts` 已承接星兽移动、吃核、死亡掉核和重生锁定，`Game.ts` 只负责传入 runtime 状态和死亡回调
- `src/game/snakeMovementSystem.ts` 已承接蛇移动前的纯评估逻辑，`Game.ts` 仍保留实际提交移动、拾取、死亡和 UI 同步
- `src/game/renderPasses.ts` 已承接单帧绘制顺序，`src/game/renderStaticLayers.ts` 已承接静态层缓存管理，`render.ts` 暂时仍保留具体绘制函数
- `src/game/renderCanvasUtils.ts` 已承接无状态 Canvas 工具，后续 background/entity/fx 分层会复用这些基础函数
- `src/game/renderBackground.ts` 已承接背景层绘制，`render.ts` 通过静态层和 pass drawer 调用它
- `src/game/renderBoard.ts` 已承接棋盘层绘制和静态棋盘快照，`render.ts` 不再直接维护棋盘底层画法
- `src/game/renderCores.ts` 已承接食物/星核绘制和共享星核视觉纯函数，`render.ts` 保留兼容导出
- `src/game/renderBlackHole.ts` 已承接黑洞本体和黑洞 cue 绘制
- `src/game/renderStarBeast.ts` 已承接星兽本体和死亡闪光绘制
- `src/game/renderStarAttractor.ts` 已承接星引仪本体和吸收特效，是 entity/fx 分层的第一块
- 网格数学、方向、距离、cell key、危险区判断等基础能力在多个文件重复存在
- UI 文案与按钮状态拼装已开始迁移到 `viewModel.ts`
- 渲染状态更新已拆到 `renderState.ts`；具体实体绘制仍有少量留在 `render.ts`，但黑洞与星兽已不再绑定在主入口里

## 当前必须保持不变的行为基线

- 方向输入使用短队列缓冲
- 撞墙保留短暂 wall grace 恢复窗口
- 基础食物保底与定时 food wave 同时存在
- 食物波次仍保持 3 个保底 + 10 上限 + 黑洞避让的当前口径
- 黑洞的危险判定与视觉表现允许分层，但规则结果不能漂移
- 星兽与掉落星核、复活流程、HUD 状态切换都必须保持现状
- 星引仪在当前版本默认停用，相关代码保留但正常流程不启用

## 当前测试基线

- `tests/blackHole.test.ts`
  - 黑洞配置、尺寸阶段、外圈判定
- `tests/gameplayRegression.test.ts`
  - 尾巴让位、自撞、wall grace
- `tests/inputController.test.ts`
  - 键盘与触控输入
- `tests/starAttractor.test.ts`
  - 星引仪解锁与停用基线
- `tests/starBeast.test.ts`
  - 星兽解锁、AI、掉核、共享视觉规则
- 还需要补充针对 `viewModel.ts` 的纯逻辑回归测试
- `tests/foodSpawn.test.ts`
  - 食物生成上下文、wave bag、候选筛选与聚类逻辑
- `tests/spawnSelectors.test.ts`
  - 共享 spawn 派生数据
- `tests/spawnRuntime.test.ts`
  - 运行时 spawn 上下文、复活阻塞列表、布局有效性
- `tests/transientSystems.test.ts`
  - 食物波 system、星核 system、星兽特效回收
- `tests/snakeMovementSystem.test.ts`
  - 蛇移动预判、尾巴让位、成长阻挡、拾取索引、方向 fallback

## 当前问题清单

- `package.json` 当前 `test` 入口覆盖 `tests/*.test.ts`，但 Windows PATH 中可能缺少 `node`
- 运行脚本依赖系统 PATH 中存在 `node`
- 测试仍大量通过内部状态直接操纵 `Game` 私有实现，`viewModel.ts` 是改善这一点的第一步
- 蛇移动提交、碰撞结算和复活状态机仍集中在 `Game.ts`
- render 低层实体与特效绘制仍有部分集中在 `render.ts`，后续应继续拆成蛇身、拖尾、粒子与奖励爆散模块
