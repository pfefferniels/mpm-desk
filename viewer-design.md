# Viewer Component Design

## Overview

A standalone viewer at `/` that presents the musical performance model as an explorable, visual experience — not a stripped-down editor. Replaces the current approach of branching on `isEditorMode` throughout components.

## Layout

```
┌─────────────────────────────────────────┐
│                                         │
│                                         │
│   ══════╤══════════╤════════════════    │
│   ~~~intensity curve + wedges~~~        │
│   ──────┴──────────┴────────────────    │
│         │          │                    │
│    [argumentation  │                    │
│     summary]    ┌──┴──────┐             │
│                 │ popover │             │
│                 │ MPM viz │             │
│                 └─────────┘             │
│                                         │
│              ┌─────────────┐            │
│              │ ▶ 1:23/4:01 │  ← liquid glass playback
│              └─────────────┘            │
└─────────────────────────────────────────┘
```

## Interactions

- **Wedge hover** → expands to show transformer circles (existing behavior)
- **Wedge click** → displays argumentation summary (new — replaces edit dialog)
- **Transformer circle hover** → floating popover with aspect-specific MPM visualization (new)
- **Pinch/scroll zoom** → horizontal stretch/compress of the curve (touch-friendly)
- **Playback** → floating controls with glassmorphism styling
- **No:** drag-and-drop, desk tabs, AppBar, metadata editing, scroll sync

## Architecture

- **Separate component tree** — a `Viewer` component composed from reused parts, not the editor with conditionals
- **Refactor shared components** — extract visualization logic from desk components (e.g. `SyntheticLine`) so they work without editing context
- **New components needed:**
  - Argumentation summary display (popover or inline panel)
  - Per-aspect MPM popover visualizations
  - Glassmorphism playback controls
  - Touch-friendly zoom handling
- **TransformerStack internals** (intensity curve, wedge layout, circle packing) are reused but wrapped differently — centered, no fixed-bottom positioning

## Open Questions

- Specific popover visualizations per aspect (tempo curve, dynamics shape, rubato offsets, articulation, pedal) — design individually as we go
- Whether the argumentation summary is a popover or an inline panel

## Implementation Order

Start with the skeleton: a `Viewer` route that renders the intensity curve + wedges centered, with playback and zoom. Then layer on interactive features (click → argumentation, hover → MPM popover) one aspect at a time, starting with tempo since `SyntheticLine` already exists.
