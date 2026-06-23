# NEON SERPENT：霓虹吞星

一个基于 Vite、TypeScript 和 Canvas 2D 的单页赛博贪吃蛇 Web 游戏。

当前版本已经进入可玩阶段，基础玩法和黑洞机制都已落地。

## 运行

```bash
npm install
npm run dev
```

构建检查：

```bash
npm run build
```

如果 PowerShell 拦截 `npm`，可以使用：

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

## 当前功能

- 全屏 Canvas。
- 根据 `devicePixelRatio` 设置 Canvas 实际像素尺寸。
- 浏览器 resize 后保持清晰。
- `requestAnimationFrame` 主循环。
- 开始、暂停、重开和基础 HUD。
- 深色宇宙背景、霓虹网格、星点和核心光环。
- 蛇移动、吃星核、增长、得分、长度、死亡和本地最高分。
- 黑洞、星门、冲刺、粒子爆炸和震屏。
- 键盘与 pointer events 输入入口。

## 下一阶段

- 继续打磨移动端摇杆与冲刺按钮的手感。
- 继续优化视觉反馈、节奏和数值平衡。

