# 架构文档

这里维护《NEON SERPENT：霓虹吞星》的内部架构上下文，目标是让代码、测试、文档三者保持同一套事实来源。

当前阶段约定：

- 先冻结现有玩法、表现、手感，再做结构优化
- 架构优化不允许偷偷改规则、数值、节奏、文案口径
- 每一轮结构改动都要同步更新这里的基线说明和测试策略

文档分工：

- `00-current-baseline.md`：当前实现的结构与行为基线
- `01-target-architecture.md`：目标架构与模块边界
- `02-simulation-pipeline.md`：后续要收敛出的主循环/系统顺序
- `03-render-pipeline.md`：渲染分层与性能热点
- `04-performance-budget.md`：性能预算与优化守则
- `05-test-strategy.md`：回归测试、验收口径和文档同步要求

当前已经落地的第一层拆分：

- `src/game/viewModel.ts`：快照、ticker、UI 派生与缓存应用的 selector 层
