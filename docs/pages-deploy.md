# GitHub Pages 发布说明

这个仓库使用 GitHub Pages + GitHub Actions 发布。

固定链接：

`https://yijunjian123-beep.github.io/snake1/`

首次需要在仓库设置里手动打开一次：

1. 打开仓库 `Settings`
2. 进入 `Pages`
3. `Build and deployment` 里把 `Source` 设为 `GitHub Actions`

之后只要把代码推到 `snake1-combo` 分支，Pages 就会继续更新同一个链接。

如果第一次还是 404，需要再补一个仓库 Secret：

1. `Settings -> Secrets and variables -> Actions`
2. `New repository secret`
3. 名字填 `PAGES_ENABLEMENT_TOKEN`
4. 内容填一个有这个仓库 Pages 管理权限的 GitHub token

这个 token 只需要用来把 Pages 站点第一次启起来。

本地预览用：

```bash
node node_modules/vite/bin/vite.js build
```
