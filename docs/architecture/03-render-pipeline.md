# Render Pipeline

## 当前现状

当前 `render.ts` 同时承担：

- renderer 创建和 pass drawer 组装
- 墙边缘预警绘制
- 背景、棋盘、实体、特效的少量入口协调

已经拆出：

- `renderQuality.ts`：画质降级与帧时间策略
- `renderState.ts`：粒子、拖尾、震屏、奖励爆散、黑洞预警透明度等渲染状态更新
- `renderOverlay.ts`：暂停、死亡、复活倒计时、黑洞顶部预警覆盖层
- `renderPasses.ts`：单帧 pass 编排，不承载具体像素画法
- `renderStaticLayers.ts`：背景层/棋盘层离屏 canvas、DPR backing store、dirty/cache 管理
- `renderCanvasUtils.ts`：Canvas 通用工具，包含尺寸测量、插值/缓动、确定性随机、cell 中心点、圆角矩形和数值 clamp
- `renderBackground.ts`：背景星空、星云、星尘、静态背景和动态星点绘制
- `renderBoard.ts`：霓虹远景网格、核心背景光、棋盘边框/格线和静态棋盘快照
- `renderCores.ts`：食物星核、掉落星核、星核爆散入场状态和共享星形 glyph 指标
- `renderBlackHole.ts`：黑洞本体与黑洞 cue 绘制
- `renderSnake.ts`：蛇身、拖尾、速度提示和头部 cue 绘制
- `renderFx.ts`：奖励爆散和普通粒子绘制
- `renderStarBeast.ts`：星兽本体与死亡闪光绘制
- `renderStarAttractor.ts`：星引仪本体与吸收流光特效绘制

## 目标拆分

建议后续收敛为：

- `qualityManager`：已对应 `renderQuality.ts`
- `renderStateUpdater`：已对应 `renderState.ts`
- `canvasUtils`：已对应 `renderCanvasUtils.ts`
- `backgroundPass`：已对应 `renderBackground.ts`
- `boardPass`：已对应 `renderBoard.ts`
- `entityPass`：食物/星核已进 `renderCores.ts`，黑洞已进 `renderBlackHole.ts`，星兽已进 `renderStarBeast.ts`，星引仪已进 `renderStarAttractor.ts`，蛇已进 `renderSnake.ts`
- `fxPass`：星引仪吸收特效已进 `renderStarAttractor.ts`，星兽死亡闪光已进 `renderStarBeast.ts`，蛇拖尾已进 `renderSnake.ts`，奖励爆散和粒子已进 `renderFx.ts`
- `overlayPass`：已对应 `renderOverlay.ts`
- `renderPasses`：已承接顺序编排，后续保持只做 pass 调度
- `renderStaticLayers`：已承接静态层缓存管理，后续低层背景/棋盘画法搬家时复用这个入口

## 优化原则

- 先保证画面结果不变，再做渲染拆分
- 静态层缓存逻辑保留，但职责单独收敛
- 特效状态更新不要再和具体绘制代码强耦合
- 具体绘制函数搬家时必须保持 pass 顺序不变，优先以截图/构建/测试确认没有视觉入口破坏
- `render.ts` 保留墙边缘预警这种单点视觉细节即可，不需要为了几个私有 helper 继续拆文件
