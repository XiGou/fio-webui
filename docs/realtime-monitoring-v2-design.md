# 实时监控 V2 设计文档（续）

## 1. 背景与目标
基于现有实时监控页面，补齐“可观测性深度”能力：

1. **时间范围筛选**：支持 15m / 1h / 6h / 24h / all。
2. **缩放与重置**：支持图表拖拽缩放后一键重置。
3. **服务端统计过滤**：`/api/runs/:id/stats` 支持 `from/to/limit`，降低前端大数据加载成本。
4. **WebSocket 实时增量渲染**：接收 `stats` 消息时即时追加点位，减少轮询延迟。

## 2. 非目标
- 不修改 fio 执行模型。
- 不重构图表库（继续使用 uPlot）。
- 不引入新的前端测试框架（当前仓库未配置 vitest/jest）。

## 3. 方案设计

### 3.1 后端
#### API 扩展
`GET /api/runs/:id/stats` 新增可选查询参数：
- `from`: Unix 秒，起始时间（含）
- `to`: Unix 秒，结束时间（含）
- `limit`: 返回最多 N 个点（保留最新 N 个）

#### 领域函数
新增 `FilterStatsPoints(points, from, to, limit)`：
- 先按时间窗口过滤；
- 再按 limit 截断；
- `from/to=0` 代表不限制。

### 3.2 前端
#### 状态新增
- `timeRange`: 15m / 1h / 6h / 24h / all
- `xDomain`: 图表当前缩放域

#### 交互新增
- 时间范围按钮组
- “重置缩放”按钮

#### 数据流
1. 切换时间范围 -> 调用 `/api/runs/:id/stats?from=...`。
2. WebSocket 收到 `stats` -> 归一化 -> 追加到当前序列。
3. 时间戳相同则覆盖最后一点，避免重复点导致图表抖动。

## 4. TODO（本轮实现）
- [x] 后端增加 stats 过滤能力。
- [x] 增加过滤函数单元测试（TDD）。
- [x] 前端增加时间范围切换。
- [x] 前端增加缩放重置。
- [x] 前端接入 WebSocket stats 增量更新。

## 5. TDD 过程记录
1. 先编写 `internal/fio/stats_filter_test.go`（红灯）：缺少 `FilterStatsPoints`。
2. 实现 `FilterStatsPoints`（绿灯）。
3. 在 handler 中接入查询参数并复用该函数。

## 6. 风险与缓解
- **风险**：WebSocket 与轮询并存导致重复点。
  - **缓解**：按时间戳覆盖最后一点。
- **风险**：不同 run 切换时 domain 污染。
  - **缓解**：切换 run/时间范围时重置 `xDomain`。
