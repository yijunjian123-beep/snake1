# Render Pipeline

## 当前现状

当前 `render.ts` 同时承担：

- 画质降级
- 背景与静态层缓存
- 渲染状态更新
- 粒子/拖尾/震屏状态维护
- 所有实体与覆盖层绘制

## 目标拆分

建议后续收敛为：

- `qualityManager`
- `renderStateUpdater`
- `backgroundPass`
- `boardPass`
- `entityPass`
- `fxPass`
- `overlayPass`

## 优化原则

- 先保证画面结果不变，再做渲染拆分
- 静态层缓存逻辑保留，但职责单独收敛
- 特效状态更新不要再和具体绘制代码强耦合
