# MPM Desk

An editor for reconstructing a recorded performance as
[Music Performance Markup (MPM)](https://github.com/axelberndt/MPM), and a viewer for reading the
result. The editor puts a recording note against note with its score, fits what the two differ by
as MPM instructions, and lets those be grouped into claims about the performance.

## Setup

```sh
npm install
npm run dev
```

Everything runs in the browser and there is no backend. verovio is vendored: `vendor/verovio`
carries a committed WebAssembly build of the
[`aligned-mei` fork](https://github.com/pfefferniels/verovio), which can lay a score out by the
times a `<recording>` gives. It only has to be rebuilt when the fork changes, see
`vendor/verovio/README.md`.

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

## Routes

`/` is the viewer. It fetches the reconstruction of WM 225 from
[welte225.org](https://welte225.org/), which holds the only copy, and draws it as a tree of claims
along the timeline, with playback. `/#<segment id>`, or an unambiguous prefix of at least eight
characters, opens it at that segment; that is where a segment's identifier
`https://welte225.org/mpm/<id>` sends a visitor.

`/editor` is the editor. The alignment desk says which sounded event realises which written note;
the others plot what the recording did in one dimension (tempo, rubato, dynamics, accentuation,
articulation, arpeggiation, pedalling) and turn a gesture on that plot into a transformer call.
Furthermore there is a desk for the document itself (title and author, which MEI voice goes into
which part) and the narrative desk, where MPM instructions can be grouped into one "narrative",
e.g. about musical direction.

## Export

A project is a zip of

    transcription.mei    the score, with one <recording> per take
    work.json            the reconstruction: transformer calls and narrative frames
    performance.mpm      the MPM the chain wrote
    score.msm            the score that MPM is performed against
    recordings/*.mid     the takes

## The published reconstruction

The reconstruction of WM 225 is the first four of those files, unzipped into `mpm/` of the
[welte225.org](https://github.com/pfefferniels/welte225.org) repository, and this repository keeps
no copy. To publish a change made in the editor, replace the files there. After a change to the
chain, `npx vite-node scripts/recordOutcomes.ts` rewrites `work.json`, `performance.mpm` and
`score.msm` in place, and `scripts/recordArtefacts.test.ts` fails until that has been done.

The tests read that checkout, expected beside this repository as `../welte225.org` or wherever
`WELTE225` points. CI checks it out into the workspace.

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
