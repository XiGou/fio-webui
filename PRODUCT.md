# FIO WebUI Product Context

<!-- impeccable:product-schema 1 -->

## Platform

Web application served by a Go backend and packaged as a single local binary.

## Users

- Storage performance engineers designing repeatable fio experiments.
- SREs and system administrators validating disks before and after infrastructure changes.
- Engineers who need an auditable link between a test definition, its live telemetry, and its final report.

## Product Purpose

FIO WebUI turns fio benchmark configuration into an executable visual pipeline. A user assembles execution nodes and jobs, validates the resulting fio task list, runs it against a target, watches evidence arrive in real time, and produces a report from the same run record.

## Positioning

The product is a visual compiler and operations console for fio, not a replacement syntax for fio. It preserves fio's global and job inheritance while making sequence, parallel execution, barriers, risk, and report provenance visible.

## Operating Context

- The application commonly runs on or near the host containing the target device.
- Write workloads can destroy data, so target identity and destructive intent must remain visible at run time.
- A run may be inspected while active and revisited later from persisted logs and normalized samples.
- The current product controls one active run per server instance.

## Capabilities And Constraints

- Build ordered execution nodes whose jobs run concurrently; each node boundary is a sequential execution barrier.
- Compile the visual definition to the existing fio task-list API before execution.
- Monitor fio stdout-derived bandwidth, IOPS, latency, progress, and runtime status in real time.
- Preserve metric-source provenance so kernel or iostat sources can be added without changing the monitoring model.
- Generate and open reports from persisted performance logs or normalized intermediate samples.
- Reuse the existing Go, React, TypeScript, Tailwind, shadcn-style component, and uPlot stack.
- Legacy configuration mode is intentionally removed; pipeline composition is the primary workflow.
- Multi-host orchestration, user authentication, and remote agent management are outside this redesign's current scope.

## Brand Commitments

- Product name: FIO WebUI.
- Interaction reference: n8n-like node composition with the directness of assembling physical test modules.
- Tone: precise, composed, industrial, and evidence-led.
- Visual language: graphite neutrals, clean white work surfaces, restrained green for healthy states, amber for risk, and red for destructive actions.
- Avoid neon graph-editor styling, gradients, playful toy metaphors, oversized marketing typography, and card-heavy dashboards.

## Product Principles

1. Execution semantics stay visible: jobs within a node run concurrently, while nodes execute in canvas order.
2. Build, validate, run, monitor, and report form one continuous workflow.
3. Advanced fio options use progressive disclosure without weakening expert control.
4. Every chart and report states where its data came from.
5. Destructive tests require deliberate review at the moment of execution.
6. Saved definitions and run evidence are distinct but visibly connected.

## Accessibility

- Target WCAG AA contrast.
- All core actions require visible keyboard focus and descriptive labels.
- Icon-only controls require tooltips or accessible names.
- Motion must be restrained and respect reduced-motion preferences.

## Evidence

This context is grounded in the existing repository APIs and data model plus the user's explicit redesign brief. Market positioning and remote-operation requirements are not asserted without further product evidence.
