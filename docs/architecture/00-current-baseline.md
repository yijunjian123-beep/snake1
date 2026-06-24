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
- `src/game/starBeast.ts`
  - 星兽生成、AI 倾向、掉核
- `src/game/starAttractor.ts`
  - 星引仪相关配置与生成逻辑
- `src/game/progression.ts`
  - 解锁条件、安全出生默认配置、长度提示文案
- `src/game/viewModel.ts`
  - 当前快照、ticker、UI 派生与 UI 缓存应用的抽离层

## 当前已确认的实现形态

- `Game.ts` 仍然是主要屎山入口，约 2300 行
- `render.ts` 仍然是主要渲染屎山入口，约 2600 行
- 黑洞、星兽、出生算法已经有独立模块，但运行时编排仍集中在 `Game.ts`
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
- 网格数学、方向、距离、cell key、危险区判断等基础能力在多个文件重复存在
- UI 文案与按钮状态拼装已开始迁移到 `viewModel.ts`
- 渲染状态更新与绘制 pass 仍写在同一个文件中

## 当前必须保持不变的行为基线

- 方向输入使用短队列缓冲
- 撞墙保留短暂 wall grace 恢复窗口
- 基础食物保底与定时 food wave 同时存在
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

## 当前问题清单

- `package.json` 之前的 `test` 入口只跑 `starBeast.test.ts`，回归面过窄
- 运行脚本依赖系统 PATH 中存在 `node`
- 测试仍大量通过内部状态直接操纵 `Game` 私有实现，`viewModel.ts` 是改善这一点的第一步
- 文档缺少统一的架构总入口
