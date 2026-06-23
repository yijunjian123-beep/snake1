# Foundation

这一阶段只做地基整理，不要明显改变当前可玩体验。

## 进度指标

- `snakeLength`：当前蛇长度
- `coresEaten`：本局吃到的星核数量
- `score`：当前分数
- `elapsedTime`：本局已进行时间，单位秒

## 解锁节奏

- `combo`：`snakeLength >= 5`
- `blackHole`：`snakeLength >= 7`
- `starGate`：`snakeLength >= 9`
- `evolution`：`coresEaten >= 6`
- `galaxyEvent`：`snakeLength >= 11` 或 `elapsedTime >= 45`
- `timeRewind`：`snakeLength >= 13` 或 `coresEaten >= 12`
- `starAttractor`：暂不启用（保留配置位）
- `starBeast`：`snakeLength >= 10`
- `boss`：`snakeLength >= 22` 或 `score >= 260`

## 功能开关

这些大系统统一通过配置控制：

- `combo`
- `blackHole`
- `starGate`
- `evolution`
- `galaxyEvent`
- `timeRewind`
- `starAttractor`（暂不启用）
- `starBeast`
- `boss`

## 安全生成契约

`findSafeSpawnPosition(...)` 的目标是尽量生成安全位置，依次避开：

- 蛇身
- 蛇头附近
- 墙边危险位置
- 黑洞
- 星门入口 / 出口
- 未来 Boss / 星兽 / 陨石危险区（星引仪暂不启用）

如果严格候选为空，函数会逐步放宽限制，最后退回到任意空位；如果仍然没有可用位置，则返回 `null`。
