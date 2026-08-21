# MPM Desk

Viewer for a score-aligned performance read as [MPM](https://github.com/axelberndt/MPM) and
an intensity curve.

## What it loads

Three baked files in `public/`, and nothing else:

| File | What it is |
|---|---|
| `segments.json` | The intensity segments. Each names the MPM elements it is made of. |
| `performance.mpm` | The performance those elements live in. |
| `score.msm` | The score, as espressivo converts it from the MEI. |

There is no derivation at load time. A segment says what it claims — move, intensify, relax
or calm, how sure, and why — over which ticks, through which MPM elements; the app draws that
and asks espressivo to render it.

`transcription.mei` and `data/info.json` are the provenance: the MEI the score comes from, and
the transformer calls the segments were derived from. Neither is fetched by the viewer, and
nothing in this repo reads them any more.

## Where the bake went

The three files were baked by mpmify's transformer pipeline. That pipeline — and the scripts
that drove it — moved to `../mpmify/scripts/bake/` when this repo dropped `mpm-ts` and
`mpmify`; see the README there. `public/` is the source of truth here.

The pipeline fits its curves by simulated annealing, so the three files must always be written
by one run — that is what baking is for, and why re-deriving them is not a thing this repo does.

## Verifying

```sh
node_modules/.bin/vite-node scripts/verifySegments.ts          # every reference lands, every selection spotlights
node_modules/.bin/vite-node scripts/verifyEspressivo.ts        # the render contract playback needs
```

## Prerequisites

Local packages that must be cloned as siblings:

- `../meico-ts` — espressivo: renders the performance, and is also the MPM document model the
  viewer reads (`src/utils/mpm.ts`; see espressivo's `docs/reading.md`)
- `../react-pianosound` — React MIDI playback hooks

## Setup

```sh
npm install
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and build for production |
| `npm run test` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run deploy` | Build and deploy to GitHub Pages |
