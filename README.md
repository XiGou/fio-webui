<p align="center">
  <a href="https://github.com/XiGou/fio-webui"><img src="https://img.shields.io/github/stars/XiGou/fio-webui?style=social" alt="Stars"></a>
  <a href="https://github.com/XiGou/fio-webui/actions"><img src="https://github.com/XiGou/fio-webui/actions/workflows/build.yml/badge.svg" alt="Build"></a>
  <a href="https://github.com/XiGou/fio-webui/releases"><img src="https://img.shields.io/github/v/release/XiGou/fio-webui?include_prereleases" alt="Release"></a>
  <a href="https://github.com/XiGou/fio-webui/blob/main/LICENSE"><img src="https://img.shields.io/github/license/XiGou/fio-webui" alt="License"></a>
</p>

<h1 align="center">FIO WebUI</h1>

<p align="center">
  <strong>Web interface for disk I/O performance testing</strong> · Go backend · React frontend · Single binary deployment
</p>

<p align="center">
  <a href="https://xigou.github.io/fio-webui/">🌐 Landing Page</a> ·
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#development">Development</a>
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| **Visual configuration** | Configure fio test parameters via Web UI—no need to hand-write job files |
| **Multiple engines** | libaio, io_uring, sync, posixaio, and more I/O engines |
| **Multiple modes** | read, write, randread, randwrite, randrw, readwrite |
| **Real-time monitoring** | WebSocket-pushed IOPS, bandwidth, and latency charts |
| **History** | Run history, parameter reuse, log summaries |
| **Single binary** | Frontend embedded—no separate deployment |

---

## Quick Start

```bash
# Download latest release (Linux / macOS / Windows)
# https://github.com/XiGou/fio-webui/releases

# Run (requires fio to be installed)
./fio-webui
# Visit http://localhost:8080
```

---

## Installation

### Prerequisites

- [fio](https://github.com/axboe/fio) (must be installed)
- Go 1.26+ (only when building from source)
- Node.js LTS (only when building frontend)

### Build from source

```bash
# Frontend + backend
make build
./fio-webui

# Or manually
cd frontend && npm install && npm run build && cd ..
CGO_ENABLED=0 go build -o fio-webui .
```

### Run flags

| Flag | Default | Description |
|------|---------|-------------|
| `-addr` | `:8080` | HTTP listen address |
| `-data` | `./data` | Run history data directory |
| `-debug` | `false` | Enable debug logging |

---

## Development

```bash
make install-air   # Install hot-reload tool (once)
make dev           # Backend (air) + frontend (Vite), Ctrl+C to exit
```

Run separately:

- Backend: `make dev-backend`
- Frontend: `make dev-frontend`

---

## Architecture

```
fio-webui/
├── main.go              # Entry, embeds web/dist
├── internal/
│   ├── fio/             # fio execution, parsing, storage
│   └── server/          # HTTP / WebSocket / API
├── frontend/            # React + Vite + shadcn/ui
└── web/dist/            # Frontend build output (embedded in binary)
```

---

## License

[MIT](LICENSE)
