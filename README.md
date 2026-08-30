# MPM Desk

An editor for reconstructing a recorded performance as [MPM](https://github.com/axelberndt/MPM),
and a viewer for reading the result. The editor puts a recording note against note with its score,
fits what the two differ by as MPM instructions, and lets those be grouped into claims about the
performance.

## Two routes

`/` is the viewer. It reads a finished reconstruction out of `public/` and draws it as a tree of
claims along the timeline, with playback. Nothing in it edits anything.

`/editor` is the editor. The alignment desk says which sounded event realises which written note;
the others plot what the recording did in one dimension (tempo, rubato, dynamics, accentuation,
articulation, arpeggiation, pedalling) and turn a gesture on that plot into a transformer call.
Beside them sit desks for the document itself (title and author, which MEI voice goes into which
part), the narrative desk, where calls are grouped and each group says what it claims, and the
markup desk, which shows the MPM that results.

They are two component trees and two bundles. What they share is underneath: `src/fitting/` runs
the chain, `src/model/` says what a work file is, espressivo renders.

## The document

A project is a zip of

    transcription.mei    the score, with one <recording> per take
    work.json            the reconstruction: the calls, and the claims they were made under
    performance.mpm      the MPM the chain wrote
    score.msm            the score that MPM is performed against
    recordings/*.mid     the takes

`work.json` is the half that reconstructs: rebuilding the chain from its `provenance` and running
it over the same MEI gives the same MPM back. `src/model/Work.ts` states the format.

## Setup

```sh
npm install
npm run dev
```

Everything runs in the browser and there is no backend. espressivo (MEI to MSM, the MPM object
model, rendering) and react-pianosound come from npm. verovio is vendored: `vendor/verovio` carries
a committed WebAssembly build of the [`aligned-mei` fork](https://github.com/pfefferniels/verovio),
which can lay a score out by the times a `<recording>` gives. It only has to be rebuilt when the
fork changes, see `vendor/verovio/README.md`.

Alignment runs an ONNX model in the browser. Only the current checkpoint ships
(`public/mlign-v4-fp16.onnx`); a document naming an older one re-aligns with this one and keeps the
record of what it used.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check `src` and build |
| `npm run typecheck` | `src`, plus `tests/` and `scripts/` |
| `npm run lint` | ESLint, warnings are errors |
| `npm test` | Vitest in watch mode (`test:run` once, `test:coverage` with coverage) |
| `npm run knip` | Unused files, exports and dependencies |
| `npm run verovio:build` | Rebuild the vendored toolkit from the fork |

Two more are run by hand over the piece in `public/`, with `npx vite-node`:
`scripts/recordOutcomes.ts` writes back what each call did, which the editor does on save and an
edit made elsewhere does not, and `scripts/verifyChain.ts` checks the reconstruction against a
recorded projection.

A push to `main` typechecks, tests, builds and deploys to Cloudflare Pages
(`.github/workflows/deploy.yml`).

## Source

| | |
|---|---|
| `src/desks/` | one directory per desk; `DeskSwitch.tsx` says which edits which aspect |
| `src/fitting/` | the transformer chain, run in a worker |
| `src/model/` | the work file, the reducer over it, saving and loading |
| `src/alignment/` | putting a recording note against note with the score |
| `src/segment-stack/` | the viewer's tree of claims |
| `src/verovio/` | the toolkit wrapper and the performed layout |
| `scripts/` | one-shot tools, run with `vite-node` |

## Disclosure

All of the code base was written by agentic AI (Claude Code).

## License

Copyright (C) 2026 Niels Pfeffer.

MPM Desk is published under **GPL-3.0-only**. It builds on
[espressivo](https://github.com/pfefferniels/espressivo), which carries those terms as a port of
[meico](https://github.com/cemfi/meico) by Axel Berndt and others, and meico's grant names version
3.0 without the "or any later version" clause. The full text is in [LICENSE](LICENSE).

The vendored verovio build under `vendor/verovio` keeps its own terms. It comes from
[rism-digital/verovio](https://github.com/rism-digital/verovio) under **LGPL-3.0-or-later**, and
the texts sit beside it in `vendor/verovio/COPYING` and `vendor/verovio/COPYING.LESSER`.
