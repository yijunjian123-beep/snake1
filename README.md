# NEON SERPENT：霓虹吞星

一个基于 Vite、TypeScript 和 Canvas 2D 的单页贪吃蛇 Web 游戏骨架。

当前阶段只完成运行框架，不包含完整玩法逻辑。

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
- 开始界面和基础 HUD 容器。
- 深色宇宙背景、霓虹网格、星点和核心光环雏形。
- 键盘与 pointer events 输入入口。
- Web Audio 与 localStorage 模块占位。

## 下一阶段

- 实现蛇移动、星核、增长、得分和死亡。
- 增加黑洞、星门、冲刺、粒子爆炸和震屏。
- 增加移动端虚拟摇杆与冲刺按钮。

