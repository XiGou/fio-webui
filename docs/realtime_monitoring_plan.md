# Fio 实时监控技术规划

## 1. Fio 控制台输出格式分析

### 1.1 Status-Interval JSON 格式

Fio 使用 `--status-interval=<seconds>` 参数定期输出 JSON 格式的状态更新到控制台（stdout）。

**当前代码中已定义的结构：**

```go
type StatusUpdate struct {
    Time   int64       `json:"time"`   // Unix timestamp (秒)
    Jobs   []JobStatus `json:"jobs"`
    Errors map[string]interface{} `json:"errors,omitempty"`
}

type JobStatus struct {
    JobName string  `json:"jobname"`
    GroupID int     `json:"groupid"`
    Error   int     `json:"error"`
    ETA     uint64  `json:"eta"`      // 预计剩余时间（秒）
    Elapsed uint64  `json:"elapsed"` // 已运行时间（秒）
    Read    IOStats `json:"read"`
    Write   IOStats `json:"write"`
    Trim    IOStats `json:"trim"`
    Sync    IOStats `json:"sync"`
}

type IOStats struct {
    IOPS      float64   `json:"iops"`        // IOPS
    BW        int64     `json:"bw"`         // 带宽（bytes/sec）
    Runtime   uint64    `json:"runtime"`      // 运行时间（毫秒）
    IOStats   []Stat    `json:"iostats"`     // 其他 IO 统计
    LatencyNs []Latency `json:"latency_ns"`  // 延迟（纳秒），按百分位
    LatencyUs []Latency `json:"latency_us"`  // 延迟（微秒），按百分位
}

type Latency struct {
    Percentile uint32 `json:"percentile"` // 百分位（如 50, 90, 95, 99, 99.9）
    Value      uint64 `json:"value"`      // 延迟值（纳秒或微秒）
}
```

### 1.2 数据提取要点

**IOPS (Input/Output Operations Per Second):**
- `Read.IOPS` / `Write.IOPS` - 读写 IOPS
- 总 IOPS = `Read.IOPS + Write.IOPS`

**Bandwidth (BW):**
- `Read.BW` / `Write.BW` - 读写带宽（bytes/sec）
- 总带宽 = `Read.BW + Write.BW`
- 转换为常见单位：KB/s = BW / 1024, MB/s = BW / (1024 * 1024)

**Latency (延迟):**
- `LatencyNs` / `LatencyUs` 数组包含多个百分位延迟
- 常用百分位：50 (中位数), 90, 95, 99, 99.9
- 单位：纳秒 (ns) 或微秒 (us)
- 通常关注：mean (平均值), p50, p95, p99

### 1.3 输出特点

1. **实时性**: `--status-interval` 定期输出（如每秒一次），适合实时监控
2. **JSON 格式**: 结构化数据，易于解析
3. **多 Job 支持**: `Jobs` 数组包含多个 job 的统计
4. **分离读写**: Read/Write/Trim/Sync 分别统计
5. **百分位延迟**: 提供详细的延迟分布

### 1.4 限制与注意事项

- JSON 输出不包含单位信息（需要根据字段名推断）
- 延迟数据可能同时存在于 `LatencyNs` 和 `LatencyUs`（优先使用 `LatencyNs` 更精确）
- 多 job 时需要聚合或分别展示
- 时间戳 `Time` 是 Unix 时间戳（秒）

## 2. 技术架构

### 2.1 数据流

```
Fio 进程 (stdout)
    ↓
StreamJSONParser (解析 JSON status updates)
    ↓
StatusUpdate (Go struct)
    ↓
WebSocket (实时传输到前端)
    ↓
前端接收并更新图表 (uplot)
```

### 2.2 后端实现

**当前状态：**
- ✅ `StreamJSONParser` 已实现，可以解析 status-interval JSON
- ✅ `StatusUpdate` 结构体已定义
- ✅ WebSocket 已实现基础功能
- ❌ 未将 status updates 通过 WebSocket 发送到前端

**需要实现：**

1. **在 `executor.go` 中监听 status updates:**
   ```go
   // 在 runFio 中启动 goroutine 监听 statusCh
   go func() {
       for status := range e.streamParser.StatusChan() {
           // 发送到 WebSocket channel
           select {
           case e.statusCh <- status:
           default:
               // Channel full, skip
           }
       }
   }()
   ```

2. **在 `websocket.go` 中发送 status updates:**
   ```go
   // 添加新的消息类型 "stats"
   case status := <-s.executor.GetStatusChan():
       sendMsg(SSEMessage{Type: "stats", Data: status})
   ```

3. **数据转换与聚合：**
   - 多 job 聚合（如需要）
   - 时间序列数据准备
   - 延迟百分位提取

### 2.3 前端实现

**当前状态：**
- ✅ uplot 已安装 (`package.json`)
- ✅ WebSocket 连接已建立
- ❌ 未实现实时图表展示

**需要实现：**

1. **安装 uplot React wrapper（如需要）:**
   ```bash
   npm install react-uplot
   ```
   或直接使用 uplot 的 React hooks

2. **数据结构：**
   ```typescript
   interface StatsDataPoint {
       time: number;        // Unix timestamp (秒)
       iops: number;        // 总 IOPS
       iopsRead: number;    // 读 IOPS
       iopsWrite: number;   // 写 IOPS
       bw: number;          // 总带宽 (MB/s)
       bwRead: number;      // 读带宽 (MB/s)
       bwWrite: number;     // 写带宽 (MB/s)
       latMean: number;     // 平均延迟 (ms)
       latP50: number;      // P50 延迟 (ms)
       latP95: number;      // P95 延迟 (ms)
       latP99: number;      // P99 延迟 (ms)
   }
   
   interface JobStats {
       jobName: string;
       data: StatsDataPoint[];
   }
   ```

3. **图表组件：**
   - IOPS 图表（总 IOPS + 读/写分离）
   - 带宽图表（总带宽 + 读/写分离）
   - 延迟图表（mean, p50, p95, p99）

4. **实时更新：**
   - WebSocket 接收 status updates
   - 转换为 `StatsDataPoint`
   - 追加到时间序列数组
   - 更新 uplot 图表

## 3. 实现方案

### 3.1 后端修改

#### 3.1.1 添加 Status Channel

在 `executor.go` 中：
```go
type Executor struct {
    // ... existing fields
    statusCh chan *StatusUpdate  // 新增
}

func NewExecutor(workDir string) *Executor {
    // ...
    return &Executor{
        // ...
        statusCh: make(chan *StatusUpdate, 100),
    }
}

func (e *Executor) GetStatusChan() <-chan *StatusUpdate {
    return e.statusCh
}
```

#### 3.1.2 转发 Status Updates

在 `runFio` 中：
```go
// 启动 goroutine 转发 status updates
go func() {
    for status := range e.streamParser.StatusChan() {
        select {
        case e.statusCh <- status:
        default:
            // Channel full, skip
        }
    }
}()
```

#### 3.1.3 WebSocket 发送 Stats

在 `websocket.go` 中：
```go
case status := <-s.executor.GetStatusChan():
    sendMsg(SSEMessage{Type: "stats", Data: status})
```

### 3.2 前端实现

#### 3.2.1 安装依赖

```bash
cd frontend
npm install uplot
# 如果需要 React wrapper
npm install react-uplot
```

#### 3.2.2 创建图表组件

创建 `frontend/src/components/StatsChart.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface StatsDataPoint {
    time: number
    iops: number
    iopsRead: number
    iopsWrite: number
    bw: number
    bwRead: number
    bwWrite: number
    latMean: number
    latP50: number
    latP95: number
    latP99: number
}

interface StatsChartProps {
    data: StatsDataPoint[]
    title: string
    type: 'iops' | 'bw' | 'lat'
}

export function StatsChart({ data, title, type }: StatsChartProps) {
    const chartRef = useRef<HTMLDivElement>(null)
    const plotRef = useRef<uPlot | null>(null)

    useEffect(() => {
        if (!chartRef.current || data.length === 0) return

        // 准备 uplot 数据格式
        const times = data.map(d => d.time)
        let series: uPlot.Series[] = []
        let values: number[][] = []

        if (type === 'iops') {
            series = [
                { label: 'Total IOPS', stroke: '#2563eb', width: 2 },
                { label: 'Read IOPS', stroke: '#10b981', width: 2 },
                { label: 'Write IOPS', stroke: '#f59e0b', width: 2 },
            ]
            values = [
                data.map(d => d.iops),
                data.map(d => d.iopsRead),
                data.map(d => d.iopsWrite),
            ]
        } else if (type === 'bw') {
            series = [
                { label: 'Total BW (MB/s)', stroke: '#2563eb', width: 2 },
                { label: 'Read BW (MB/s)', stroke: '#10b981', width: 2 },
                { label: 'Write BW (MB/s)', stroke: '#f59e0b', width: 2 },
            ]
            values = [
                data.map(d => d.bw),
                data.map(d => d.bwRead),
                data.map(d => d.bwWrite),
            ]
        } else if (type === 'lat') {
            series = [
                { label: 'Mean (ms)', stroke: '#2563eb', width: 2 },
                { label: 'P50 (ms)', stroke: '#10b981', width: 2 },
                { label: 'P95 (ms)', stroke: '#f59e0b', width: 2 },
                { label: 'P99 (ms)', stroke: '#ef4444', width: 2 },
            ]
            values = [
                data.map(d => d.latMean),
                data.map(d => d.latP50),
                data.map(d => d.latP95),
                data.map(d => d.latP99),
            ]
        }

        const plotData: uPlot.AlignedData = [times, ...values]

        const opts: uPlot.Options = {
            title,
            width: chartRef.current.offsetWidth,
            height: 300,
            series: [
                {}, // x-axis (time)
                ...series,
            ],
            axes: [
                {
                    label: 'Time',
                },
                {
                    label: type === 'iops' ? 'IOPS' : type === 'bw' ? 'MB/s' : 'ms',
                },
            ],
            scales: {
                x: { time: true },
            },
        }

        if (plotRef.current) {
            plotRef.current.setData(plotData)
        } else {
            plotRef.current = new uPlot(opts, plotData, chartRef.current)
        }

        return () => {
            if (plotRef.current) {
                plotRef.current.destroy()
                plotRef.current = null
            }
        }
    }, [data, type, title])

    return <div ref={chartRef} />
}
```

#### 3.2.3 在 App.tsx 中集成

```typescript
// 添加状态
const [statsData, setStatsData] = useState<StatsDataPoint[]>([])

// WebSocket 消息处理
ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as WsMessage
    if (msg.type === 'stats') {
        const status = msg.data as StatusUpdate
        // 转换为 StatsDataPoint
        const point = convertStatusToDataPoint(status)
        setStatsData(prev => [...prev, point])
    }
}

// 渲染图表
{statsData.length > 0 && (
    <>
        <StatsChart data={statsData} title="IOPS" type="iops" />
        <StatsChart data={statsData} title="Bandwidth" type="bw" />
        <StatsChart data={statsData} title="Latency" type="lat" />
    </>
)}
```

## 4. 最终报告生成

### 4.1 数据来源

运行完成后，可以从两个来源生成报告：

1. **实时收集的数据**: 运行过程中收集的 `StatsDataPoint[]` 数组
2. **Fio 最终输出**: 运行结束后的完整 JSON 输出（`--output-format=json`）

### 4.2 报告内容

1. **摘要统计**:
   - 平均 IOPS、峰值 IOPS
   - 平均带宽、峰值带宽
   - 平均延迟、P95/P99 延迟

2. **时间序列图表**:
   - IOPS 趋势
   - 带宽趋势
   - 延迟趋势

3. **分布统计**:
   - IOPS 分布直方图
   - 延迟分布直方图

4. **多 Job 对比**（如适用）:
   - 各 Job 的性能对比
   - 各 Job 的时间线

### 4.3 实现方案

**方案 A: 使用实时数据**
- 优点: 数据已收集，无需额外解析
- 缺点: 可能丢失部分细节（如完整的延迟分布）

**方案 B: 解析最终 JSON 输出**
- 优点: 数据完整，包含所有统计信息
- 缺点: 需要解析 JSON，可能较大

**推荐方案: 混合方案**
- 实时数据用于图表展示
- 最终 JSON 用于生成详细报告
- 两者结合提供最佳体验

## 5. 实施步骤

### Phase 1: 后端数据流
1. ✅ 已有 `StreamJSONParser` 和 `StatusUpdate` 结构
2. ⏳ 添加 `statusCh` 到 `Executor`
3. ⏳ 在 `runFio` 中转发 status updates
4. ⏳ 在 WebSocket handler 中发送 stats 消息

### Phase 2: 前端基础
1. ⏳ 安装 uplot（如未安装）
2. ⏳ 创建 `StatsChart` 组件
3. ⏳ 添加 WebSocket stats 消息处理
4. ⏳ 数据转换函数

### Phase 3: 图表展示
1. ⏳ 集成图表到主界面
2. ⏳ 多 job 支持（如需要）
3. ⏳ 响应式布局
4. ⏳ 图表样式优化

### Phase 4: 报告生成
1. ⏳ 收集最终 JSON 输出
2. ⏳ 解析并生成报告数据
3. ⏳ 创建报告页面/组件
4. ⏳ 导出功能（PDF/JSON/CSV）

## 6. 参考资源

- [uplot 官方文档](https://github.com/leeoniya/uPlot)
- [Fio JSON 输出格式](https://fio.readthedocs.io/en/latest/fio_doc.html)
- [Fio Status Interval](https://fio.readthedocs.io/en/latest/fio_doc.html#cmdoption-arg-status-interval)
