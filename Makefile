# FIO WebUI - 开发与构建
# 使用 make 或 make help 查看目标

.PHONY: help dev dev-backend dev-frontend install-air init-ai-skills test build ci run clean

help:
	@echo "FIO WebUI Makefile"
	@echo ""
	@echo "  开发"
	@echo "    make dev           - 同时启动后端(air)与前端(Vite)，Ctrl+C 一并退出"
	@echo "    make dev-backend   - 仅启动后端（热加载，需先 make install-air）"
	@echo "    make dev-frontend  - 仅启动前端"
	@echo ""
	@echo "  工具"
	@echo "    make install-air   - 安装 air（Go 热加载）"
	@echo "    make init-ai-skills - 初始化 AI 设计技能（impeccable）"
	@echo ""
	@echo "  测试与构建"
	@echo "    make test         - 运行 Go 单测（-race，与 CI 一致）"
	@echo "    make build        - 构建前端并编译 Go 二进制"
	@echo "    make ci           - 完整 CI 流程：test + build"
	@echo "    make run          - 运行已构建的二进制（默认 :8080）"
	@echo "    make clean        - 清理构建产物与 Air 临时目录"

# 同时跑后端+前端：后端用 air 热加载，前端用 Vite；Ctrl+C 会结束两者
dev:
	@(trap 'kill 0' 2; air & cd frontend && npm run dev; wait)

# 仅后端（热加载，监听 :8080）
dev-backend:
	@air

# 仅前端（Vite，API 代理到 localhost:8080）
dev-frontend:
	@cd frontend && npm run dev

# 安装 air，用于 make dev / make dev-backend
install-air:
	@go install github.com/air-verse/air@latest
	@echo "air 已安装，可直接运行: make dev-backend 或 make dev"

# 初始化 AI 设计类 skill（impeccable）
init-ai-skills:
	@./scripts/init_ai_env.sh

# 运行 Go 单测（-race，与 GitHub Actions CI 一致）
test:
	@CGO_ENABLED=1 go test -v -race -short ./...

# 构建：先构建前端，再编译 Go（嵌入 web/dist）
build:
	@cd frontend && npm install && npm run build && cd ..
	@go build -o fio-webui .

# 完整 CI 流程：test + build
ci: test build

# 运行已构建的二进制
run:
	@./fio-webui

# 清理
clean:
	@rm -rf tmp build-errors.log fio-webui
	@echo "已清理 tmp/、build-errors.log、fio-webui"
