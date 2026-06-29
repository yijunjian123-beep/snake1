# AGENTS.md

## 项目目标

本项目是一个 5 小时内可交付的创意贪吃蛇 Web 游戏，名字为《NEON SERPENT：霓虹吞星》。

目标不是做复杂系统，而是做一个第一眼惊艳、运行稳定、电脑和手机都能玩的单页游戏。

## 技术栈

- Vite
- TypeScript
- Canvas 2D
- 原生 CSS
- 默认不使用后端；仅在线 PVP 改造允许新增最小 Node.js + TypeScript WebSocket 后端
- 不使用外部图片、字体、音频素材
- 允许使用浏览器原生 Web Audio API 生成音效

## 在线 PVP 例外规则

在线 PVP 是唯一允许突破“无后端”的方向。新增内容必须服务于 1v1 真人联机，并且保持单人 PVE 和 `localPvp` 本地双人烟测入口可玩。

允许新增：
- Node.js + TypeScript WebSocket PVP 后端。
- shared PVP 协议类型。
- shared PVP 游戏逻辑。
- 服务端房间管理。
- 服务端随机匹配。
- 服务端权威 tick / 权威 gameOver。
- Docker 部署配置。
- GitHub Pages 前端部署配置。
- PVP 压测脚本。

禁止新增：
- 数据库。
- 登录系统。
- 支付。
- 排行榜。
- 大型后端框架，除非项目已有。
- 把网络逻辑直接塞进 UI 组件。
- 硬编码生产 WebSocket 地址。
- 破坏 PVE 和 `localPvp`。

部署目标：
- 前端部署到 GitHub Pages。
- 后端部署到腾讯云轻量应用服务器 / CVM / Docker，运行 Node 服务。
- 生产 WebSocket 地址格式：`wss://your-domain/ws`。
- 本地 WebSocket 地址：`ws://localhost:8787/ws`。
- 前端必须通过 `VITE_PVP_WS_URL` 读取后端地址。

当前生产基线（Prompt 14 及之后不得回退）：
- GitHub Pages 前端地址：`https://yijunjian123-beep.github.io/snake1/`。
- 腾讯云 PVP 后端域名：`pvp.junjian.site`，解析到 `43.135.51.107`。
- 生产 WebSocket 地址：`wss://pvp.junjian.site/ws`。
- GitHub Actions repository variable 必须保留：`VITE_PVP_WS_URL=wss://pvp.junjian.site/ws`。
- GitHub Pages 的 Source 必须保持为 `GitHub Actions`，`github-pages` environment 必须允许 `snake1-pvp` 分支部署。
- 后端由 Docker 跑 Node PVP 服务，本机端口 `127.0.0.1:8787`，Nginx 负责 `443`/HTTPS/WSS 反向代理。
- 对外正式只依赖 `80/443`；不要把生产前端改回 `ws://localhost`、服务器 IP 直连或硬编码 WebSocket 地址。

容量目标：
- 200 人同时在线。
- 约 100 个并发 1v1 房间。
- `maxConnections` 默认 250。
- `maxRooms` 默认 120。
- `maxQueue` 默认 250。

## 设备要求

桌面端：
- 横屏体验优先
- 支持 WASD 和方向键
- 支持空格键冲刺
- 支持 P 暂停
- 支持 R 重开

移动端：
- 自动显示虚拟摇杆
- 左下角摇杆控制方向
- 右下角按钮用于冲刺
- 适配横屏
- 竖屏时显示横屏提示遮罩，但不要让页面崩坏
- 使用 pointer events，不要只写 mouse events

## 玩法要求

必须实现：
- 蛇移动
- 吃星核增长
- 得分
- 连击倍率
- 碰撞死亡
- 重新开始
- 暂停
- 本地最高分 localStorage

创意机制：
- 黑洞障碍
- 星门传送
- 冲刺
- 粒子爆炸
- 震屏
- 背景脉冲

## 视觉要求

整体风格：
- 赛博霓虹
- 深色宇宙背景
- 发光蛇身
- 粒子尾迹
- 玻璃拟态 UI
- 高对比度
- 第一眼要像完整游戏，而不是普通 demo

性能要求：
- 目标 60 FPS
- 粒子数量需要设置上限
- Canvas 需要适配 devicePixelRatio
- resize 时保持游戏可玩
- 不要引入重型依赖

## 代码要求

请优先使用清晰模块结构：

- src/main.ts
- src/game/Game.ts
- src/game/types.ts
- src/game/input.ts
- src/game/render.ts
- src/game/audio.ts
- src/game/storage.ts
- src/styles.css

要求：
- TypeScript 不要使用 any，除非非常必要
- 关键逻辑写清楚注释
- 每个阶段完成后运行 npm run build
- 如果 build 失败，先修复再总结
- 不要为了炫技牺牲可玩性
- 不要添加多余框架
- 除在线 PVP 例外规则外，不要添加联网功能
- 不要添加账号系统
- 不要添加真实货币、广告、数据库、登录系统、支付或排行榜
- 除在线 PVP 最小服务外，不要添加其他后端能力

## 工作方式

每次实现前先给出简短计划。

实现后请输出：
1. 改了哪些文件
2. 当前可玩的功能
3. 如何运行
4. 是否通过 npm run build
5. 下一步建议

如果时间有限，优先顺序是：

1. 能玩
2. 手机和电脑都能控制
3. 视觉惊艳
4. 音效
5. 额外机制
