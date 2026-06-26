# 前端部署到 GitHub Pages

## 1. 启用 GitHub Pages
1. 打开仓库 `Settings`。
2. 进入 `Pages`。
3. 在 `Build and deployment` 里把 `Source` 设为 `GitHub Actions`。
4. 保存后，推送代码时会自动发布。

## 2. GitHub Actions 如何配置
仓库使用 `.github/workflows/pages.yml`。

workflow 至少执行这些步骤：
1. install
2. typecheck
3. test
4. build
5. upload dist
6. deploy GitHub Pages

其中：
- `VITE_BASE_PATH` 在 workflow 中设置为 `/${{ github.event.repository.name }}/`
- `VITE_BUILD_VERSION` 在 workflow 中设置为 `${{ github.sha }}`
- `VITE_PVP_WS_URL` 从 GitHub repository variable 读取

## 3. `VITE_PVP_WS_URL` 在哪里配置
在 GitHub 仓库的 `Settings` -> `Secrets and variables` -> `Actions` 里配置 repository variable。

推荐值：

```text
VITE_PVP_WS_URL=wss://your-pvp-domain/ws
```

不要在生产包里写死 `ws://localhost:8787/ws`。

如果你还没把腾讯云后端正式接成域名，先不要发布正式 GitHub Pages 版本；等后端有可用的 `wss://` 地址后再填这个变量。

## 4. 前端最终 URL 格式
Project Pages 的最终地址格式是：

```text
https://<github-username>.github.io/<repo-name>/
```

如果仓库名是 `snake1`，生产构建的 base path 应该是 `/snake1/`。

## 5. 本地 production build 验证方式
在本地用 production 配置验证：

```powershell
$env:VITE_BASE_PATH = "/<repo-name>/"
$env:VITE_PVP_WS_URL = "wss://your-pvp-domain/ws"
npm.cmd run build
npm.cmd run preview
```

然后打开：

```text
http://127.0.0.1:4173/<repo-name>/
```

检查资源没有 404，PVE 可以直接进入，PVP 服务不可用时也不会白屏。

## 6. 常见问题
- 白屏：通常是 base path 错了，确认 `VITE_BASE_PATH` 和预览路径一致。
- 资源 404：通常是打包时用了 `/`，Project Pages 必须用 `/<repo-name>/`。
- base path 错误：GitHub Pages 的项目站点不是站点根目录，不能直接用 `/`。
- HTTPS 页面不能连接 `ws://`：GitHub Pages 是 HTTPS，PVP 必须使用 `wss://`。
- PVP 服务不可用但 PVE 仍可玩：前端应继续加载单人模式，只把 PVP 状态显示为 disconnected。

## 7. 和腾讯云后端的配合

后端接入完成前，前端最多只能做本地构建验证，不能把“能打包”当成“能联机”。

正式联机前要同时满足：

1. 腾讯云后端能访问 `/health`。
2. 腾讯云后端能访问 `/metrics.json`。
3. 浏览器能连上 `wss://.../ws`。
4. GitHub Pages 的 `VITE_PVP_WS_URL` 已经填好。
