# GitHub Pages 发布说明

这个仓库使用 GitHub Pages + GitHub Actions 发布到 `gh-pages` 分支。

固定链接：

`https://yijunjian123-beep.github.io/snake1/`

首次需要在仓库设置里手动打开一次：

1. 打开仓库 `Settings`
2. 进入 `Pages`
3. `Build and deployment` 里把 `Source` 设为 `GitHub Actions`

之后只要把代码推到 `snake1-combo` 分支，Actions 就会自动把最新构建推到 `gh-pages` 分支，Pages 地址保持不变。

本地预览用：

```bash
node node_modules/vite/bin/vite.js build
```
