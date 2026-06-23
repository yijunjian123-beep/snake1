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

## 下一步

- 继续细化移动端手感和战斗反馈
- 继续平衡星兽与黑洞的节奏
