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

## 在线 PVP 改造规则

项目默认仍是无后端的单页游戏；在线 PVP 是唯一允许新增最小后端的例外。允许新增 Node.js + TypeScript WebSocket PVP 后端、shared PVP 协议类型、shared PVP 游戏逻辑、服务端房间管理、服务端随机匹配、服务端权威 tick / 权威 gameOver、Docker 部署配置、GitHub Pages 前端部署配置和 PVP 压测脚本。

在线 PVP 禁止新增数据库、登录系统、支付、排行榜和大型后端框架；网络逻辑不能直接塞进 UI 组件，不能硬编码生产 WebSocket 地址，也不能破坏 PVE 和 `localPvp`。

部署与配置目标：

- 前端：GitHub Pages。
- 后端：腾讯云轻量应用服务器 / CVM / Docker 运行 Node 服务。
- 生产 WebSocket：`wss://your-domain/ws`。
- 本地 WebSocket：`ws://localhost:8787/ws`。
- 前端通过 `VITE_PVP_WS_URL` 读取后端地址。

容量目标：

- 200 人同时在线。
- 约 100 个并发 1v1 房间。
- `maxConnections` 默认 250。
- `maxRooms` 默认 120。
- `maxQueue` 默认 250。

## 架构状态

- `Game.ts` 仍是运行时编排入口，但 spawn、瞬态更新、碰撞结算、复活状态机、星引仪吸收结算、UI 派生、渲染状态已经拆成独立模块
- 星兽已分为 `starBeast.ts`、`starBeastSimulation.ts`、`renderStarBeast.ts` 和对应测试；星引仪当前停用，但配置/生成、吸收结算、渲染保留在 `starAttractor.ts`、`starAttractorSystem.ts`、`renderStarAttractor.ts`
- `render.ts` 主要负责 renderer 装配和 pass drawer；单帧 pass、静态层、背景层、棋盘层、蛇身/拖尾、粒子/奖励爆散，以及黑洞/星兽/星引仪实体绘制已经拆成独立模块
- 架构上下文见 `docs/architecture/`

## 下一步

- 后续只在确有收益时继续收束拾取后的计分、补货、UI/音效副作用
- 不继续拆一次性视觉细节和小 helper，避免为了文件数牺牲可维护性
