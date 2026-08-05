---
name: FIO WebUI
description: Industrial fio pipeline workbench and evidence console.
colors:
  graphite: "hsl(216 20% 13%)"
  sheet: "hsl(210 20% 98%)"
  surface: "hsl(0 0% 100%)"
  workbench: "hsl(210 18% 95%)"
  sidebar: "hsl(210 18% 96%)"
  muted: "hsl(210 16% 94%)"
  muted-ink: "hsl(215 12% 43%)"
  border: "hsl(210 13% 84%)"
  input: "hsl(210 13% 78%)"
  primary: "hsl(162 72% 27%)"
  primary-soft: "hsl(164 28% 91%)"
  live: "hsl(190 76% 34%)"
  warning: "hsl(36 92% 42%)"
  destructive: "hsl(0 67% 45%)"
typography:
  body:
    fontFamily: "Noto Sans SC, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Noto Sans SC, Microsoft YaHei, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "10px"
    letterSpacing: "0"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
---

# Design System: FIO WebUI

<!-- impeccable:design-schema 1; scan-mode record of the shipped implementation -->

## Overview

**Creative North Star: "The Calibrated Signal Bench"**

Concept seed `ae3ddf58` is realized as an Operate-mode **CNC calibration sheet + rack-mounted signal chain**. FIO WebUI is a storage-lab console, not a generic node editor: ruled work surfaces, rack labels, signal paths, run states, and evidence provenance define the world. Finish reviewer status: **APPROVED**.

The durable journey is `build -> validate -> run -> monitor -> report`. Node order, job concurrency, inheritance, risk, source, and persisted artifacts remain visible across that journey.

## Colors

Graphite and cool white carry the workspace. Green means selected, healthy, or committed; cyan means live transport; amber means write risk; red means failure, stop, or delete. Semantic color is scarce and always paired with text or an icon. Gradients, neon, glass, and decorative color fields are outside the system.

## Typography

Use Noto Sans SC with Microsoft YaHei and system sans fallbacks for interface text. Use the monospace stack for fio keys, run IDs, timestamps, values, units, sample metadata, and stdout. Page titles are compact (16px); panel titles and labels sit in the 10-14px range. Letter spacing is always zero; there is no display or hero type inside the application.

## Layout

Desktop uses a 64px navigation rail. At `1280px` and wider, the workbench is `220px module palette / flexible canvas / 360px inspector`. Regions meet edge-to-edge with 1px dividers rather than floating section cards. The canvas keeps intrinsic module width and scrolls horizontally so pipeline semantics do not collapse.

Below `1280px`, the rail becomes a 56px horizontal top bar and the palette, canvas, and inspector stack in workflow order. Below `768px`, navigation text hides while accessible names remain; header actions wrap, touch targets stay usable, and the signal path scrolls instead of shrinking.

## Elevation & Depth

The bench is flat by default. Borders and tonal surface changes establish hierarchy. Module items and stages may use a small ambient shadow; hover adds a restrained lift, selection adds a green border/halo, and dialogs use stronger elevation because they interrupt execution.

## Shapes

Major panels, module items, stages, and evidence bands are rectilinear. Controls use small 2-6px radii. Circles are functional only: connector sockets, status lamps, terminals, and switch thumbs.

## Components

- **Module item:** 52px minimum height, square equipment body, 1px border, muted 28px icon well, concise label, monospace detail, and a plus or amber risk lamp.
- **Execution node:** Fixed-width white module on the signal path with operation number, name, concurrent Job count, visible jobs, and local add/move/delete tools. Selected state uses the primary border and halo. One node compiles to one fio task; nodes execute in canvas order.
- **Job:** A row inside its node showing workload name, compact fio summary, inheritance context, and selection state; all Jobs in one node run concurrently, and Job overrides remain distinct from node-shared values.
- **Terminal:** Compile and report endpoints close the pipeline. Round terminal marks are allowed because they represent signal endpoints, not decoration.
- **Badge:** 20px-high bordered status label with explicit wording such as `LIVE`, `READ ONLY`, `WRITE PATH`, or `校验通过`; never an unlabeled color pill.
- **Fields and buttons:** 36px default control height, compact 32px option, small radius, visible 2px focus ring, Lucide icons, and disabled opacity without removing the label.
- **Metric evidence:** IOPS, bandwidth, and latency always show units and useful context. Active metrics name `fio stdout/status`; reports name the persisted `taskN_iops.log`, `taskN_bw.log`, `taskN_lat.log`, and `taskN_clat_hist.log` sources. Report charts use uPlot, show every execution node boundary, and expose IOPS/BW mean and max plus completion-latency mean, p99, and max. `stats.jsonl` is labeled only as a compatibility fallback.
- **Write-risk dialog:** Validation must pass before opening it. It labels read-only versus write path, counts destructive jobs, warns that target data may be overwritten, and repeats target, structure, duration, and metric source before confirmation. Amber marks risk; red remains for stop, delete, and failure.

## Do's and Don'ts

**Do** preserve definition-to-report provenance, including WebSocket live capture, stdout/status, persisted `stats.jsonl`, logs, and report artifacts.

**Do** keep target identity and destructive intent visible at launch time; trap dialog focus, support Escape, focus cancel first, and restore focus to the trigger.

**Do** maintain keyboard-visible focus, descriptive labels, accessible names/tooltips for icon-only controls, WCAG AA contrast, and `prefers-reduced-motion` behavior.

**Don't** hide node order, job concurrency, inheritance, units, source, or write risk inside generic summaries.

**Don't** turn the shipped bilingual uppercase micro-labels into a universal eyebrow pattern; they are local rack/evidence markings, not a reusable heading requirement.
