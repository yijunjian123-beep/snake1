# 在线 PVP 总控计划

本文件是《NEON SERPENT：霓虹吞星》从本地 PVP 垫层推进到公司群可试玩在线 PVP 的总控文档。执行时以本文为阶段边界，配合 `docs/pvp-test-plan.md` 做回归与验收记录。

## 最终目标

- 前端静态资源部署到 GitHub Pages。
- 后端单独部署到腾讯云轻量应用服务器、CVM 或 Docker 环境，提供 HTTP 健康检查与 WebSocket 服务。
- 同事打开 GitHub Pages 链接后可以玩单人模式、创建房间码邀请好友 PVP、随机匹配真人 PVP。
- 目标容量是约 200 人同时在线、约 100 个并发 1v1 对局，但只有通过压测后才能对外这样描述。
- 生产环境前端必须连接 `wss://` 后端地址，不能连接 `ws://localhost`。
- 生产 WebSocket 地址格式为 `wss://your-domain/ws`，本地开发地址为 `ws://localhost:8787/ws`。
- 前端必须通过 `VITE_PVP_WS_URL` 读取后端地址，不能在代码里硬编码生产地址。
- GitHub Pages 只承载静态前端，不能承载 WebSocket 后端。

## 规则变更范围

在线 PVP 是本项目唯一允许新增后端的例外；其他玩法和页面仍遵守单页游戏、轻依赖、无账号、无数据库的原则。

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

容量默认值：

- `maxConnections` 默认 250。
- `maxRooms` 默认 120。
- `maxQueue` 默认 250。

## 当前基线

- 已有 PVE / PVP 入口。
- 已有本地 PVP 地基：双蛇 tick、碰撞、胜负、重开、输入队列和 `?localPvp=1` 烟测入口。
- PVP 房间入口已经接上最小 WebSocket 后端。
- P2 现在通过在线真人输入同步驱动，不再是 `scripted` 占位；`scripted` 只保留给 `?localPvp=1` 烟测。
- 真实 WebSocket、房间、匹配队列、网络同步、断线处理、重连、部署与压测已进入实现和验收阶段。

## 当前生产部署基线（阶段 13.5 已完成）

后续 Prompt 14/15 是体验打磨和验收推进，不应回退以下生产接入：

- GitHub Pages 前端：`https://yijunjian123-beep.github.io/snake1/`
- 腾讯云公网 IP：`43.135.51.107`
- PVP 后端域名：`pvp.junjian.site`
- HTTPS 健康检查：`https://pvp.junjian.site/health`
- HTTPS 指标接口：`https://pvp.junjian.site/metrics.json`
- 生产 WebSocket：`wss://pvp.junjian.site/ws`
- GitHub Actions repository variable：`VITE_PVP_WS_URL=wss://pvp.junjian.site/ws`
- GitHub Pages Source：`GitHub Actions`
- `github-pages` environment 允许 `snake1-pvp` 分支部署
- 后端 Docker 服务只在本机端口 `127.0.0.1:8787` 给 Nginx 反代，公网正式入口只走 `80/443`

禁止后续阶段把生产前端改成 `ws://localhost:8787/ws`、公网 IP 直连、GitHub Pages 承载后端，或在前端源码中硬编码生产 WebSocket 地址。

## 不可破坏红线

- 不破坏单人模式：必须能进入、开始、结束、重开。
- PVP 服务不可用时，单人模式仍可玩，前端不能白屏。
- 不破坏 `?localPvp=1` 本地 PVP 烟测入口。
- 不为了重构而重构；每次只解决一个可验收目标。
- 不把大量网络逻辑塞进 UI 组件。
- 协议、状态机、网络客户端、服务端房间管理、游戏逻辑必须分层。
- 第一版不接数据库、不接登录、不接支付、不接排行榜。
- 不引入大型后端框架，除非项目已经有对应框架。
- 不硬编码生产 WebSocket 地址，前端只从 `VITE_PVP_WS_URL` 读取。
- 服务端第一版状态全部内存化，服务重启后房间清空可以接受。
- 默认容量上限为 `maxConnections=250`、`maxRooms=120`、`maxQueue=250`，超过上限必须返回明确错误，不能无界排队或建房。

## 验证命令

每个阶段完成后必须运行等价的三类检查：

```bash
npx tsc --noEmit
npm test
npm run build
```

如果当前 Windows 环境里 `npm`、`npx` 或 `node` 不在 PATH，按 `docs/architecture/05-test-strategy.md` 的捆绑 Node 方式执行等价命令：

```bash
node node_modules/typescript/bin/tsc --noEmit
node --test --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs tests/*.test.ts
node node_modules/vite/bin/vite.js build
```

如果任一检查失败，先修复失败，不进入下一阶段。

## 分层目标

### 协议层

- 定义客户端到服务端消息、服务端到客户端消息、错误码、房间状态和匹配状态。
- 输入命令沿用本地 PVP 的核心形状：`playerId + tick + action + kind + sequence`。
- 消息解析必须有运行时校验，不能信任浏览器传来的任意 JSON。
- 协议变更必须补测试。

### 前端网络层

- 独立网络客户端模块负责连接、断开、重连、消息解析和状态通知。
- UI 只调用清晰的客户端 API，不直接拼 WebSocket 消息。
- 生产构建必须拒绝 `ws://localhost` 作为 PVP 后端地址。
- 生产构建必须从 `VITE_PVP_WS_URL` 读取 `wss://your-domain/ws` 形态的地址。
- 后端不可用时只显示可恢复提示，不影响 PVE。

### 服务端层

- 独立后端进程提供 `/health`、`/metrics.json` 和 WebSocket endpoint。
- 第一版只使用内存房间、内存匹配队列和内存连接表。
- 服务端负责房间状态、准备状态、输入转发、匹配配对、断线判定和基础指标。
- 服务端最终必须负责权威 tick 和权威 `gameOver`；未完成前不能对外宣称完全权威 PVP。

### 游戏同步层

- 第一版优先同步输入与 tick，不同步完整画面。
- 客户端保留本地预测和 `localPvp` 烟测路径。
- 迟到、重复、乱序输入按 `sequence` 去重。
- 房间逻辑和 PVP 规则应优先沉入 shared 游戏逻辑，避免前端、后端各写一套规则。
- 出现不可恢复不同步时必须有明确结束或提示路径，不能让房间卡死。

## 阶段计划

### 阶段 1：协议与配置骨架

可验收目标：

- 新增共享 PVP 协议类型与运行时校验。
- 新增前端后端地址配置读取逻辑。
- 生产环境校验阻止 `ws://localhost`。
- 不接真实房间，不改现有 PVP UI 行为。

测试要求：

- 协议消息合法/非法解析测试。
- 生产 `wss://` 与本地开发 `ws://localhost` 配置测试。
- `?localPvp=1` 现有测试继续通过。

### 阶段 2：最小后端健康检查

可验收目标：

- 新增独立后端入口。
- `/health` 返回服务健康状态。
- `/metrics.json` 返回基础指标：启动时间、连接数、房间数、匹配队列人数。
- 尚不接前端房间创建。

测试要求：

- 后端健康检查测试。
- 指标 JSON 结构测试。
- 前端 PVE/PVP 现有测试继续通过。

### 阶段 3：WebSocket 连接骨架

可验收目标：

- 后端接受 WebSocket 连接并维护连接计数。
- 前端网络客户端可以连接、断开、收到服务端 hello。
- 服务不可用时前端显示失败提示，不白屏，不影响 PVE。
- PVP 房间按钮仍不伪造创建成功。

测试要求：

- 网络客户端状态机测试。
- 后端连接计数测试。
- 服务不可用回退测试。

### 阶段 4：房间码 MVP

可验收目标：

- 创建 2 人房间并返回房间码。
- 第二个真实浏览器可通过房间码加入。
- 双方准备后进入倒计时。
- P2 不再是 `scripted`，房间模式使用远端真人输入。

测试要求：

- 房间创建、加入、满员、离开测试。
- 两连接输入转发测试。
- 两个真实浏览器人工完成房间码 PVP。

### 阶段 5：随机匹配 MVP

可验收目标：

- 玩家可进入随机匹配队列。
- 两名玩家自动配成 1v1 房间。
- 取消匹配和断线会从队列移除。

测试要求：

- 匹配队列配对测试。
- 取消匹配测试。
- 两个真实浏览器人工完成随机匹配 PVP。

### 阶段 6：断线、重连与房间收尾

可验收目标：

- playing 中断线不会卡死房间。
- 对手离线有明确状态。
- 超时后房间能结束或清理。
- 重连策略有明确限制和提示。

测试要求：

- playing 断线测试。
- 房间清理测试。
- 重复连接和异常关闭测试。

### 阶段 7：部署配置

可验收目标：

- GitHub Pages production build 资源不 404。
- 生产环境只连接 `wss://` 后端地址。
- 后端可部署到腾讯云轻量应用服务器、CVM 或 Docker。
- `/health` 与 `/metrics.json` 在部署环境可访问。

测试要求：

- Pages 构建资源路径检查。
- 生产后端地址检查。
- 部署后 HTTP 健康检查。

### 阶段 7.5：腾讯云真实接入

可验收目标：

- 腾讯云服务器 `43.135.51.107` 上可以启动 PVP Docker 后端。
- 无域名时至少能完成临时 `http://43.135.51.107:8787/health` 和 `/metrics.json` 验证。
- 有域名后必须完成 `https://后端域名/health`、`https://后端域名/metrics.json` 和 `wss://后端域名/ws` 验证。
- GitHub Pages 的 `VITE_PVP_WS_URL` 指向真实 `wss://` 后端。
- 后端 `ALLOWED_ORIGINS` 包含 GitHub Pages 的完整 origin。

测试要求：

- `npm run smoke:pvp-remote -- --base-url http://43.135.51.107:8787 --origin http://localhost:5173 --skip-ws` 可用于无域名临时检查。
- `npm run smoke:pvp-remote -- --base-url https://后端域名 --origin https://<username>.github.io --require-wss` 必须在正式接入后通过。
- 没有正式 `wss://` 前，不进入上线前体验打磨和最终验收。

### 阶段 8：200 客户端压测

可验收目标：

- 200 客户端 WebSocket 压测连接成功率 >= 98%。
- 200 客户端能匹配出接近 100 个 1v1 对局。
- 压测期间服务端无未捕获异常、无崩溃。
- 只有通过此阶段后，才能在发布文案里写接近 200 人同时在线能力。

测试要求：

- 压测脚本。
- 压测记录。
- 服务端日志与指标截图或等效记录。

## 发布门禁

全部通过前，不允许生成公司群发布文案。

- [ ] 两个真实浏览器可以完成房间码 PVP。
- [ ] 两个真实浏览器可以完成随机匹配 PVP。
- [ ] P2 不再是 `scripted` 模拟。
- [ ] playing 中断线不会卡死房间。
- [ ] 服务不可用时前端不白屏，单人模式仍可玩。
- [ ] GitHub Pages production build 资源不 404。
- [ ] HTTPS 页面只连接 `wss://`，不能连接 `ws://`。
- [ ] 后端 `/health` 正常。
- [ ] 后端 `/metrics.json` 正常。
- [ ] 200 客户端 WebSocket 压测连接成功率 >= 98%。
- [ ] 200 客户端能匹配出接近 100 个 1v1 对局。
- [ ] 服务端压测期间无未捕获异常、无崩溃。
- [ ] typecheck、test、build 全部通过。

## 阶段汇报格式

每个阶段完成后汇报：

1. 改了哪些文件。
2. 当前可玩的功能。
3. 如何运行。
4. 是否通过 typecheck、test、build。
5. 下一步建议。

## 相关文档

- `docs/new-elements/05-local-pvp-foundation.md`：本地 PVP 垫层说明。
- `docs/pvp-test-plan.md`：PVP 回归、人工测试和性能记录口径。
- `docs/pvp-performance-record-template.md`：PVP 性能记录模板。
- `docs/deploy-frontend.md`：GitHub Pages 静态发布说明。
- `docs/architecture/05-test-strategy.md`：测试命令和 Windows 捆绑 Node 兜底方式。
