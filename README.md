<p align="center">
  <a href="https://github.com/XiGou/fio-webui"><img src="https://img.shields.io/github/stars/XiGou/fio-webui?style=social" alt="Stars"></a>
  <a href="https://github.com/XiGou/fio-webui/actions"><img src="https://github.com/XiGou/fio-webui/actions/workflows/build.yml/badge.svg" alt="Build"></a>
  <a href="https://github.com/XiGou/fio-webui/releases"><img src="https://img.shields.io/github/v/release/XiGou/fio-webui?include_prereleases" alt="Release"></a>
  <a href="https://github.com/XiGou/fio-webui/blob/main/LICENSE"><img src="https://img.shields.io/github/license/XiGou/fio-webui" alt="License"></a>
</p>

<h1 align="center">FIO WebUI</h1>

<p align="center">
  <strong>磁盘性能测试的 Web 界面</strong> · Go 后端 · React 前端 · 单二进制部署
</p>

<p align="center">
  <a href="https://xigou.github.io/fio-webui/">🌐 落地页</a> ·
  <a href="#功能">功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#安装">安装</a> ·
  <a href="#开发">开发</a>
</p>

---

## 功能

| 特性 | 描述 |
|------|------|
| **可视化配置** | 通过 Web 界面配置 fio 测试参数，无需手写 job 文件 |
| **多引擎支持** | libaio、io_uring、sync、posixaio 等 IO 引擎 |
| **多模式** | read、write、randread、randwrite、randrw、readwrite |
| **实时监控** | WebSocket 推送 IOPS、带宽、延迟曲线 |
| **历史记录** | 运行记录、参数复用、日志摘要 |
| **单二进制** | 前端嵌入，无需独立部署 |

---

## 快速开始

```bash
# 下载最新 release（Linux / macOS / Windows）
# https://github.com/XiGou/fio-webui/releases

# 运行（需已安装 fio）
./fio-webui
# 访问 http://localhost:8080
```

---

## 安装

### 前置依赖

- [fio](https://github.com/axboe/fio)（需预先安装）
- Go 1.26+（仅从源码构建时）
- Node.js LTS（仅构建前端时需要）

### 从源码构建

```bash
# 前端 + 后端
make build
./fio-webui

# 或手动
cd frontend && npm install && npm run build && cd ..
CGO_ENABLED=0 go build -o fio-webui .
```

### 运行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-addr` | `:8080` | HTTP 监听地址 |
| `-data` | `./data` | 运行历史数据目录 |
| `-debug` | `false` | 开启调试日志 |

---

## 开发

```bash
make install-air   # 安装热加载工具（仅需一次）
make dev           # 后端(air) + 前端(Vite)，Ctrl+C 退出
```

单独运行：

- 后端：`make dev-backend`
- 前端：`make dev-frontend`

---

## 架构

```
fio-webui/
├── main.go              # 入口，嵌入 web/dist
├── internal/
│   ├── fio/             # fio 执行、解析、存储
│   └── server/          # HTTP / WebSocket / API
├── frontend/            # React + Vite + shadcn/ui
└── web/dist/            # 前端构建产物（嵌入二进制）
```

---

## License

[MIT](LICENSE)
