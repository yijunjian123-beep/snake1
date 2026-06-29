# PVP 测试计划

## 目标

验证在线 PVP 的三条主路径都稳定可玩：

1. 默认点击 PVP 后自动随机匹配。
2. 创建房间后可通过房间码加入。
3. 房间码输入错误时有明确反馈，不会卡死或误入流程。

同时保证 PVE 和 `?localPvp=1` 不回归。

## 覆盖范围

- 自动匹配
- 创建房间
- 输入房间码加入房间
- 取消匹配
- 断线 / 重连 / 刷新
- 服务端容量与错误码
- 远端 smoke 与压测
- 前端控制器与服务端协议回归

## 固定回归顺序

每轮 PVP 回归先跑：

```bash
npm run typecheck
npm test
npm run build
npm run test:pvp-server
```

如果本机 `node` / `npm` 不可用，使用项目既有的捆绑 Node 方式执行等价命令。

## 1. 自动随机匹配

检查点：

- 点击 PVP 后自动连接服务并进入随机匹配。
- 页面显示排队人数、在线人数、等待时间。
- 两名玩家进入队列后依次收到 `matchFound`、`countdown`、`gameStart`。
- 不需要点准备。
- 取消匹配会发送 `matchmakingCancel`，并回到 PVP 大厅。

建议补测：

- 连续点击随机匹配不会创建重复队列。
- 排队中断线后能重新进入。
- 倒计时中断线后能正确退回。
- 开局后断线能进入结算或恢复流程。

## 2. 创建房间

检查点：

- 点击创建房间后返回合法房间码。
- 房间码是只读的，可以复制。
- 房主看到等待好友加入。
- 第二名玩家加入后双方都看到同一个房间码和玩家列表。
- 两人都准备后进入倒计时和 `gameStart`。

建议补测：

- 房间满员时第三人得到 `room_full`。
- 房主退出后房间清理正常。
- 房间等待超时后给出明确提示。
- 断线重连后房间状态能恢复。

## 3. 输入房间码加入

检查点：

- 输入会自动转大写。
- 非法字符会被过滤。
- 输入不足 4 位时，加入按钮保持禁用，不发请求。
- 输入满 4-8 位时才允许加入。
- 加入成功后能看到玩家列表、准备状态和正确房间码。

建议补测：

- 小写、空格、特殊字符、超长输入都能被归一化。
- 无效房间码返回 `room_not_found`。
- 已满房间码返回 `room_full`。
- 从随机匹配切换到加入房间时，旧连接不会污染新流程。

## 4. 可玩性与同步

检查点：

- `gameStart` 后双方都进入在线 PVP。
- 在线模式不回退到 scripted P2。
- 本地输入通过 `input { seq, tick, direction }` 发送。
- 远端输入通过 `peerInput` 进入同一 tick 队列。
- 服务端快照和 `gameOver` 是权威结果。

建议补测：

- 碰墙、自撞、撞对手、平局、对手断线都能正确结算。
- 重开后 match、world、players、inputs、winner 都清空。
- PVE 和 `?localPvp=1` 始终可玩。

## 5. 容量与部署

检查点：

- `/health` 可用。
- `/metrics.json` 可用。
- `maxConnections=250`、`maxRooms=120`、`maxQueue=250` 的边界错误都能返回正确文案。
- 生产前端只通过 `VITE_PVP_WS_URL` 读取后端地址。
- 生产构建不应包含 `ws://localhost`。

建议补测：

- `queue_full`
- `room_capacity_reached`
- `capacity_reached`
- `service_busy`
- `room_not_found`

## 6. 人工双客户端验收

随机匹配：

- 浏览器 A 点击 PVP，进入排队。
- 浏览器 B 点击 PVP，双方自动开局。
- 连续完成至少 3 局。

房间码：

- 浏览器 A 创建房间。
- 浏览器 B 输入房间码加入。
- 双方准备并开局。
- 连续完成至少 3 局。

移动端：

- 横屏可进入 PVP。
- 摇杆、冲刺按钮、输入框都可用。
- 竖屏遮罩不崩坏。

## 7. 远端 smoke / 压测

本地 smoke：

```bash
npm run loadtest:pvp -- --clients 20 --duration 20 --input-rate 10 --ramp-up 5
```

压测：

```bash
npm run loadtest:pvp -- --clients 200 --duration 120 --input-rate 10 --ramp-up 10
```

远端 smoke：

```bash
npm run smoke:pvp-remote -- --base-url https://pvp.junjian.site --origin https://yijunjian123-beep.github.io --require-wss
```

通过标准：

- 连接成功率 >= 98%
- peak active rooms 接近 100
- `/health`、`/metrics.json`、`wss://pvp.junjian.site/ws` 都正常

## 通过标准

- 随机匹配能从点击 PVP 到开局完整闭环。
- 房间码能创建、复制、输入、加入、准备、开局、结算。
- 错误输入不会卡死，且提示清楚。
- 在线 PVP 至少 10 局人工测试无阻塞异常。
- PVE 和 `?localPvp=1` 无回归。

