# 项目分析与架构建议

## 参考文档

- **fio 官方文档（本地）**：[docs/fio_doc.md](docs/fio_doc.md) — 从 [fio Read the Docs](https://fio.readthedocs.io/en/latest/fio_doc.html) 摘录的本地副本，涵盖概述、Job 文件格式、常用参数等，开发时可直接查阅。
- **docs 目录说明**：[docs/README.md](docs/README.md)。

## 项目概览
这是一个基于 Go 的 fio Web UI，用于配置和运行磁盘性能测试，并实时展示带宽、IOPS、延迟等指标。当前实现以单体后端为核心，前端为静态页面 + 最小化 JS 框架，静态资源通过 `embed.FS` 打包进单个二进制文件。

## 当前技术栈
- 后端: Go 1.21+，`net/http`，`gorilla/websocket`
- 前端: 静态页面 + Alpine.js + 原生 JS
- 可视化: uPlot.js
- 部署: 单二进制，静态资源内嵌

## 核心模块与职责
- `main.go`: 程序入口，初始化并运行 HTTP 服务
- `internal/server`: HTTP 路由、静态资源、WebSocket 推送
- `internal/fio`: 运行 fio、解析输出、统计数据
- `web/static`: HTML/JS/CSS 等静态资源

## 主要接口与数据流
- `GET /api/options`: 获取 IO 引擎、读写模式、块设备等选项
- `POST /api/run`: 提交配置并启动 fio
- `POST /api/stop`: 停止当前任务
- `GET /api/status`: 查询当前运行状态
- `GET /api/events`(WebSocket): 实时推送状态与输出
- `GET /api/defaults`: 获取默认全局与 Job 配置

数据流简述:
1. 前端提交配置到 `/api/run`
2. 后端启动 fio 并解析输出
3. 运行状态/输出通过 WebSocket 推送
4. 前端接收并更新图表与日志

## 架构更新建议 (前后端分离 + 无模板)
需求重点: 前端不使用 `template`，前后端分离；前端选择本场景最简单易用的框架。

### 推荐前端框架
**Alpine.js**
- 体积小、API 简单，适合表单和简单状态
- 无需构建步骤，直接通过 CDN 引入
- 与 WebSocket/REST API 集成简单

### 更新后的目标架构
**后端**:
- 保留 Go 服务与现有 API、WebSocket
- 不再渲染模板，仅提供 API + 静态资源服务
- 生产环境仍可将前端构建产物内嵌进二进制，保持单文件部署体验

**前端**:
- 静态页面 + Alpine.js，作为后端的静态资源
- 通过 `/api/*` 调用后端接口
- 通过 WebSocket 接收实时数据

### 当前目录结构 (更新后)
```
fio-webui/
├── main.go
├── internal/
│   ├── fio/
│   └── server/
└── web/
    └── static/             # HTML/JS/CSS (可被 embed)
```

### 开发与构建流程建议
- 前端开发:
  - 直接编辑 `web/static/index.html` 与 JS 文件
  - 若需要前后端分离部署，可配合反向代理或 CORS
- 构建与部署:
  - 后端内嵌 `web/static` 并直接返回 `index.html`

### 后端路由调整要点
- 移除模板渲染逻辑
- `/` 直接返回 `web/static/index.html`
- 其余静态资源从 `/static/*` 提供
- API 与 WebSocket 路由保持不变

## 风险与注意事项
- 前后端分离后，前端不再通过模板获取默认配置，需要启动时调用 `/api/options` 与 `/api/defaults`
- 若前后端独立部署，需要处理 CORS 或使用反向代理
- WebSocket 路径需要在前端配置为可切换 (开发环境指向本地后端)

## 结论
本项目结构清晰、依赖少，适合保持后端 Go 逻辑稳定的同时，使用 Alpine.js 实现无模板、前后端分离的静态前端。这样既满足“前后端分离、无模板”的需求，又能保持单文件部署的优势。
