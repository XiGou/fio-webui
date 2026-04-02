# 项目分析与架构说明

## 参考文档

- **fio 官方文档（本地）**：[docs/fio_doc.md](docs/fio_doc.md) — 从 [fio Read the Docs](https://fio.readthedocs.io/en/latest/fio_doc.html) 摘录的本地副本，涵盖概述、Job 文件格式、常用参数等，开发时可直接查阅。
- **docs 目录说明**：[docs/README.md](docs/README.md)。

## 项目概览

这是一个基于 Go 的 fio Web UI，用于配置和运行磁盘性能测试，并实时展示带宽、IOPS、延迟等指标。后端为单体 Go 服务，前端为 React SPA，通过 Vite 构建后嵌入 `web/dist`，最终以单二进制文件部署。

## 当前技术栈

- **后端**: Go 1.21+，`net/http`，`gorilla/websocket`
- **前端**: React 18 + TypeScript + Vite
- **UI**: shadcn/ui（基于 Radix UI）+ Tailwind CSS + lucide-react
- **图表**: uPlot.js
- **部署**: 单二进制，前端构建产物 (`web/dist`) 内嵌

## 核心模块与职责

- `main.go`: 程序入口，嵌入 `web/dist/*`，初始化 Server 并运行 HTTP 服务；支持 `-addr`、`-debug`、`-data` 参数
- `internal/server`: HTTP 路由、WebSocket、静态资源服务；`server.go` 路由注册，`handlers.go` API 实现，`websocket.go` 实时推送
- `internal/fio`: fio 执行与输出解析
  - `executor.go`: 启动/停止 fio、解析流式 JSON、状态管理
  - `run_store.go`: 运行记录持久化（`./data/runs/<id>/`）
  - `stream_parser.go`: 流式 JSON 解析与统计聚合
  - `stats.go`、`job.go`、`options.go`、`logparser.go`：统计、Job 配置、选项、日志解析
  - `uuid.go`: 运行 ID 生成
- `frontend/src`: React 前端源码
  - `App.tsx`: 主配置与运行页面（多 Task + 多 Job 配置、Start/Stop、状态、日志摘要、图表面板）
  - `HistoryPage.tsx`: 历史运行列表与详情
  - `PresetsPage.tsx`: 预设负载选择
  - `Layout.tsx`: 布局与导航
  - `StatsChart.tsx`: IOPS/BW/Latency 图表
- `web/dist`: 前端构建产物（由 Go 嵌入）

## 目录结构

```
fio-webui/
├── main.go                  # 入口，嵌入 web/dist
├── frontend/                # React + Vite + shadcn/ui 源码
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── lib/
│   │   ├── data/
│   │   └── types/
│   └── package.json
├── internal/
│   ├── server/
│   │   ├── server.go
│   │   ├── handlers.go
│   │   ├── websocket.go
│   │   └── sse.go           # SSE 实现（当前未挂载，使用 WebSocket）
│   └── fio/
│       ├── executor.go
│       ├── run_store.go
│       ├── stream_parser.go
│       ├── stats.go
│       ├── job.go
│       ├── options.go
│       ├── logparser.go
│       └── uuid.go
├── web/
│   └── dist/                # 前端构建产物（被 embed）
├── data/                    # 持久化目录（-data 指定，默认 ./data）
│   └── runs/<run-id>/       # 每次运行的 config.json、stats.jsonl、output.log 等
├── docs/
├── Makefile
└── .air.toml
```

## 主要接口与数据流

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/options` | IO 引擎、读写模式、块设备列表 |
| GET | `/api/defaults` | 默认全局与 Job 配置 |
| POST | `/api/validate` | 校验 FioConfig，返回错误 |
| POST | `/api/run` | 提交 `FioTaskList` 或 `FioConfig`，启动 fio |
| POST | `/api/stop` | 停止当前运行 |
| GET | `/api/status` | 当前运行状态 |
| GET | `/api/stats` | 当前运行的统计历史（图表用） |
| GET | `/api/events` | WebSocket 实时推送 `status`、`stats` |
| GET | `/api/runs` | 历史运行列表 |
| GET | `/api/runs/<id>` | 单次运行详情（meta + config） |
| GET | `/api/runs/<id>/stats` | 单次运行的统计点 |
| GET | `/api/runs/<id>/log-summary` | 单次运行日志摘要 + 错误 |
| DELETE | `/api/runs/<id>` | 删除历史记录 |
| GET | `/api/debug/files` | Debug 模式下列出工作目录文件 |

### 数据流

1. 前端提交 `FioTaskList`（多 Task，每 Task 含 global + jobs）到 `POST /api/run`
2. 后端通过 `Executor` 启动 fio，`StreamJSONParser` 解析输出并写入 `RunStore`
3. 运行状态与统计点通过 WebSocket `/api/events` 推送
4. 前端接收 `status`、`stats` 消息，更新图表与 UI
5. 历史数据从 `data/runs/<id>/` 加载，通过 `/api/runs` 系列接口查询

## 配置模型

- **FioTask**: 一个任务，包含 `global`（ioengine、direct、runtime 等）和 `jobs[]`
- **FioTaskList**: 多个 Task 顺序执行
- **Job**: 支持 `stonewallAfter`（前序 Job 完成后再执行）、`runtime`、`ioengine` 覆盖

## 开发与构建

- **开发**: `make dev` 同时启动后端（air 热加载）和前端（Vite），前端代理到 `:8080`；开发时 WebSocket 会直连 `:8080`
- **单测后端**: `make dev-backend`
- **单测前端**: `make dev-frontend`
- **构建**: `make build` → `cd frontend && npm run build` + `go build -o fio-webui .`
- **运行**: `./fio-webui` 或 `./fio-webui -addr :9000 -data ./data -debug`

## 风险与注意事项

- 前后端分离：前端通过 `/api/options` 与 `/api/defaults` 获取配置，后端不渲染模板
- 独立部署时需处理 CORS 或使用反向代理
- WebSocket 在 Vite 开发（5173/5174）时指向 `host:8080`，生产时使用当前 host
- `data/` 目录需持久化，否则历史记录丢失

## 结论

项目已实现前后端分离：Go 提供 REST + WebSocket，React 前端通过 Vite 构建后嵌入。支持多 Task、多 Job、stonewall、配置校验与历史记录，架构清晰、依赖少，适合在此基础上继续迭代。
