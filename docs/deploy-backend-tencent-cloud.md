# PVP 后端腾讯云接入

这份文档对应你现在的阶段 13.5：先把现有 PVP 后端真正跑到腾讯云服务器上，再决定是先临时验证，还是直接接正式域名和 `wss://`。

你当前的服务器信息：

- 公网 IPv4：`43.135.51.107`
- 地域：中国香港
- 配置：2 核 / 4 GB / 70 GB SSD

## 先说结论

1. **如果还没有域名**，先做“临时验证方案”。
2. **如果已经有域名**，直接做“正式接入方案”。
3. **如果只是想先让 AI 继续推进**，下一步应该给 AI 的不是 Prompt 14/15，而是“请把腾讯云后端接入做完”。

## 需要准备什么

### 必需

- 服务器登录方式：OrcaTerm / 密码 / SSH 密钥，三选一能进机子就行。
- 腾讯云控制台权限：能改安全组、能配域名解析、能申请证书。
- 这台机器上能安装 Docker。

### 正式 `wss://` 还需要

- 一个域名，例如 `pvp.example.com`
- 这个域名能解析到 `43.135.51.107`
- 一个 HTTPS 证书

## 路径 A：先做临时验证

适合你还没有域名的时候。

### 1. 服务器侧端口

先在腾讯云安全组放行：

- `22`
- `8787`，只用于临时验证

### 2. 跑后端

在服务器上进入仓库后执行：

```bash
docker build -t neon-serpent-pvp .
docker run -d \
  --name neon-serpent-pvp \
  --restart unless-stopped \
  -p 8787:8787 \
  -e PORT=8787 \
  -e NODE_ENV=production \
  -e PVP_MAX_CONNECTIONS=250 \
  -e PVP_MAX_ROOMS=120 \
  -e PVP_MAX_QUEUE=250 \
  -e PVP_HEARTBEAT_INTERVAL_MS=10000 \
  -e PVP_CONNECTION_TIMEOUT_MS=30000 \
  -e ALLOWED_ORIGINS="http://localhost:5173,https://<你的 GitHub Pages origin>" \
  neon-serpent-pvp
```

### 3. 验证

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/metrics.json
```

你也可以在自己电脑上测公网 IP：

```bash
npm run smoke:pvp-remote -- --base-url http://43.135.51.107:8787 --origin http://localhost:5173 --skip-ws
```

### 4. 这条路径的限制

- 只能证明后端跑起来了。
- 不能作为正式 GitHub Pages `wss://` 上线方案。
- HTTPS 页面不能稳定连 `ws://43.135.51.107:8787/ws`。

## 路径 B：正式接入

适合你已经有域名的时候。

### 1. 域名解析

把例如 `pvp.example.com` 解析到：

```text
43.135.51.107
```

### 2. 开放端口

腾讯云安全组放行：

- `22`
- `80`
- `443`

一般不再对外开放 `8787`，让 Nginx 只转发到本机 `127.0.0.1:8787`。

### 3. 跑容器

```bash
docker compose -f deploy/docker-compose.pvp.yml up -d --build
```

### 4. 配 Nginx

仓库里有示例：`deploy/nginx/pvp.conf`。

你要确保：

- `/health` 代理到后端
- `/metrics.json` 代理到后端
- `/ws` 做 WebSocket upgrade
- TLS 由 Nginx 处理

### 5. GitHub Pages 变量

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 里配置：

```text
VITE_PVP_WS_URL=wss://pvp.example.com/ws
```

同时确认后端允许你的 GitHub Pages origin，例如：

```text
https://<username>.github.io
```

### 6. 验证

```bash
curl https://pvp.example.com/health
curl https://pvp.example.com/metrics.json
```

远端烟测：

```bash
npm run smoke:pvp-remote -- --base-url https://pvp.example.com --origin https://<username>.github.io --require-wss
```

## 你现在该做什么

如果你还没有域名，先做路径 A，别急着做 Prompt 14/15。

如果你已经有域名，直接做路径 B，然后再回到 Prompt 14/15。

## 常见问题

### 服务器能 ping，但网页连不上

通常是安全组、Nginx、证书或 `VITE_PVP_WS_URL` 配错。

### HTTPS 页面连不上 WebSocket

检查是不是还在用 `ws://`。生产页面必须用 `wss://`。

### 502

通常是后端容器没起来，或者 Nginx 指错了本机端口。

### Origin rejected

把 GitHub Pages 的完整 origin 加进 `ALLOWED_ORIGINS`。

### 先别写“支持 200 人”

除非你真的跑过 200 人压测并通过，否则不要把这句话写进发布文案。

