# FIO WebUI

一个基于 Go + HTML Template + JavaScript 的 fio 磁盘性能测试 Web 界面。

## 功能

- 通过 Web 界面配置 fio 测试参数
- 支持多种 IO 引擎: libaio, io_uring, sync, posixaio
- 支持多种读写模式: read, write, randread, randwrite, randrw, readwrite
- 实时监控带宽、IOPS、延迟 (使用 uPlot.js 可视化)
- 单个二进制文件，静态资源嵌入

## 构建

```bash
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

## 依赖

- fio (需要预先安装)
- Go 1.21+

## 架构

```
fio-webui/
├── main.go              # 入口，嵌入静态资源
├── internal/
│   ├── fio/             # fio 执行和日志解析
│   │   ├── executor.go  # 运行 fio 命令
│   │   ├── job.go       # job 配置结构
│   │   └── logparser.go # 解析 log 文件
│   └── server/          # HTTP 服务
│       ├── server.go
│       ├── handlers.go
│       └── sse.go       # SSE 推送实时数据
└── web/
    ├── templates/       # Go html/template
    └── static/          # CSS, JS (包含 uPlot)
```

## 截图

Web 界面包含:
- 左侧: 配置面板 (全局设置 + Job 设置)
- 右上: 实时图表 (带宽/IOPS/延迟)
- 右下: 输出日志
# fio-webui
