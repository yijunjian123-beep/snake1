# Combo / Double Core

这次更新把连击系统和双星核一起落地。

## 规则

- 进入 combo 解锁：`snakeLength >= 5` 或 `coresEaten >= 4`
- combo 记录在运行中持续累积，但未解锁前不展示复杂 UI
- 星核场上同时保持 2 个，吃掉一个会补回一个

## combo 数据

- `comboCount`：当前连击数
- `comboMultiplier`：当前倍率
- `comboTimer`：剩余倒计时
- `comboMaxTimer`：倒计时上限，默认 `4000ms`
- `lastCoreEatTime`：最近一次吃核时间
- `isComboUnlocked`：是否正式启用 combo

## 倍率

- `1-2`：`1x`
- `3-5`：`2x`
- `6-9`：`3x`
- `10+`：`4x`

## 视觉

- 背景会随着 combo 强度脉冲增强
- 吃核时会触发更强的粒子和闪光
- HUD 中央显示 combo、倍率和剩余时间条
