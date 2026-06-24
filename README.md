# NEON SERPENT：霓虹吞星

一个基于 Vite、TypeScript 和 Canvas 2D 的单页贪吃蛇 Web 游戏。

## 运行

```bash
npm install
npm run dev
```

构建检查：

```bash
npm run build
```

如果 PowerShell 拦截 `npm`，可以用：

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

## 当前功能

- 全屏 Canvas 和 DPR 适配
- 深色宇宙背景、霓虹网格和核心光环
- 蛇移动、吃星核、增长、得分、死亡和本地最高分
- 黑洞、星门、冲刺、粒子爆炸和震屏
- 星引仪当前暂不启用，源码保留，后续可恢复
- 星兽追击与星核爆散（蛇长度 10 后解锁；兽核沿用普通星核外观与爆散动画）
- 键盘与 pointer events 输入入口

## 架构状态

- `Game.ts` 仍是运行时编排入口，但 spawn、瞬态更新、UI 派生、渲染状态已经开始拆成独立模块
- `render.ts` 仍保留少量蛇身、拖尾、粒子和奖励爆散绘制，单帧 pass、静态层、背景层、棋盘层，以及黑洞/星兽实体绘制已经拆成独立模块
- 架构上下文见 `docs/architecture/`

## 下一步

- 继续把蛇移动提交、碰撞结算、复活状态机拆成 simulation systems
- 继续把 `render.ts` 的蛇身、拖尾、粒子和奖励爆散绘制拆成更细的 entity / fx 模块
