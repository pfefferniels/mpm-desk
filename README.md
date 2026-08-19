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
the transformer calls the segments were derived from. Neither is fetched by the viewer.

## Re-baking

`scripts/bakeSegments.ts` runs mpmify's transformer pipeline over the MEI and `data/info.json`
and writes the three files. It is the only place that pipeline still runs.

```sh
node_modules/.bin/vite-node scripts/bakeSegments.ts            # dry run, reports what it would write
node_modules/.bin/vite-node scripts/bakeSegments.ts -- --write
node_modules/.bin/vite-node scripts/verifySegments.ts          # re-derive and diff against public/
node_modules/.bin/vite-node scripts/verifyEspressivo.ts        # the render contract playback needs
```

The pipeline fits its curves by simulated annealing, so the three files must always be written
by one run — that is what baking is for.

## Prerequisites

Local packages that must be cloned as siblings:

- `../meico-ts` — espressivo, the MPM renderer (npm name `espressivo`)
- `../mpm-ts` — MPM document model
- `../mpmify` — the transformer pipeline; bake-time only, plus two curve helpers the
  instruction popovers draw with
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
