# PVP 压测

这个脚本用来验证在线 PVP 的连接、匹配、房间吞吐和 `/metrics.json`。

## 启动

先确保 PVP 服务端在跑，默认地址：

```bash
ws://localhost:8787/ws
```

运行压测：

```bash
npm run loadtest:pvp -- --clients 200 --duration 120 --input-rate 10 --ramp-up 10
```

20 人 smoke test：

```bash
npm run loadtest:pvp -- --clients 20 --duration 20 --input-rate 10 --ramp-up 5
```

## 参数

- `--url`：WebSocket 地址，默认 `ws://localhost:8787/ws`
- `--clients`：客户端数量，默认 `200`
- `--duration`：压测时长，单位秒，默认 `120`
- `--input-rate`：playing 状态下每个客户端每秒发送输入次数，默认 `10`
- `--ramp-up`：客户端分批接入时长，单位秒，默认 `10`

## 结果判断

- 连接成功率低于 `98%` 直接失败
- 200 人压测应能让 `peak active rooms` 接近 `100`
- `peak playingRooms` 只作为辅助观察值
- `p95 ping/pong` 超过 `300ms` 会给 warning
- 任何 `unknown` error 都视为异常

## 输出内容

脚本会输出：

- 成功连接数
- welcome 成功数
- 入队成功数
- matchFound / gameStart / gameOver 数
- error code 聚合
- 平均匹配等待时间
- ping/pong p50 / p95 / p99
- 断线数
- 采样到的服务端 metrics 快照
- `peak active rooms` / `peak playingRooms` / `peak countdownRooms`
