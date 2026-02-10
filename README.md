# FIO WebUI

基于 Go 后端 + React (Vite + shadcn/ui) 前端的 fio 磁盘性能测试 Web 界面。

## 功能

- 通过 Web 界面配置 fio 测试参数
- 支持多种 IO 引擎: libaio, io_uring, sync, posixaio
- 支持多种读写模式: read, write, randread, randwrite, randrw, readwrite
- 实时状态与输出日志 (WebSocket)
- 单二进制部署，前端构建产物嵌入

## 构建

先构建前端，再构建 Go（会嵌入 `web/dist`）：

```bash
cd frontend && npm install && npm run build && cd ..
go build -o fio-webui .
```

## 运行

```bash
# 默认监听 :8080
./fio-webui

# 指定端口
./fio-webui -addr :9000
```

访问 http://localhost:8080

## 开发

使用 [Makefile](Makefile) 启动开发环境（推荐）：

```bash
make install-air   # 仅需一次，安装 Go 热加载工具
make dev           # 同时启动后端(air) + 前端(Vite)，Ctrl+C 一并退出
```

或分别启动：

- 后端: `make dev-backend`（等价于 `air`，监听 :8080）
- 前端: `make dev-frontend`（等价于 `cd frontend && npm run dev`）

浏览器访问 Vite 提供的地址（如 http://localhost:5173）。更多目标见 `make help`。

### 后端热加载（Air）

修改 Go 代码后自动重新编译并重启服务：

```bash
# 安装 air（仅需一次）
go install github.com/air-verse/air@latest

# 在项目根目录运行，替代 go run main.go
air
```

配置见项目根目录 [.air.toml](.air.toml)，默认监听 `:8080`，仅监视 `*.go` 变更。

## 依赖

- fio（需预先安装）
- Go 1.21+
- Node.js 18+（仅构建前端时需要）

## 架构

```
fio-webui/
├── main.go              # 入口，嵌入 web/dist
├── internal/
│   ├── fio/             # fio 执行与输出解析
│   └── server/          # HTTP / WebSocket 服务
├── frontend/            # React + Vite + shadcn/ui
│   └── src/
└── web/
    └── dist/            # 前端构建产物（由 Go 嵌入）
```

## 截图

Web 界面包含:
- 左侧: 配置面板 (全局设置 + Job 设置)
- 右上: 实时图表 (带宽/IOPS/延迟)
- 右下: 输出日志
# fio-webui
