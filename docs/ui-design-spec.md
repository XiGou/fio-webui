# UI 设计规范（内部开发）

> 该文档用于开发复用，不在用户 UI 中直接暴露。

## 1. 组件密度

- 间距 token 统一使用 4/8/12/16（`--space-1..4`）。
- 表单控件高度使用 `--control-height`，紧凑模式下自动降级。
- 卡片内边距使用 `--card-padding`，紧凑模式收敛为更高信息密度。

## 2. 排版规范

- 一级标题 `text-lg`，模块标题 `text-base`，说明文本 `text-sm + muted-foreground`。
- 页面块级节奏建议 `space-y-4`，块内细分建议 `space-y-2 / gap-2`。

## 3. 图表规范

- 支持单图与多图并排（指标对比）模式。
- 支持时间范围切换（15m/1h/6h/24h/全部）。
- 支持局部缩放（窗口范围 + drag-to-zoom）与重置缩放。

## 4. 交互反馈规范

- 运行中：`status-running`
- 成功：`status-success`
- 失败：`status-failure`
- 警告：`status-warning`

应在浅色/深色主题下都保证可读性。
