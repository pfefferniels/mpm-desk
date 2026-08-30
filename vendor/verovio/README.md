# verovio, built from the fork

The WebAssembly toolkit built from [the fork](https://github.com/pfefferniels/verovio) on branch
`aligned-mei`, which adds a layout that places each note at the time a `<recording>` says it was
played instead of at the position its notated duration would give it.

The voices desk uses it two ways: notated by default, because voices are a notational fact —
layers are what stems and beams show — and performed as the evidence view, which is what tells you
whether two layers of a staff are really two voices or one hand rolling a chord.

## What is here

`dist/` is committed, so nothing has to be built to run the app. `build-info.json` records the
commit it came from.

    dist/verovio-module.mjs   the emscripten module, ~7 MB, with the wasm base64'd into it
    dist/verovio.mjs          the JavaScript wrapper, as ES module
    dist/verovio.cjs          the same, as CommonJS

The entry-point names are upstream's on purpose (`verovio/wasm`, `verovio/esm`), so
`@types/verovio` still applies. The eleven `performance*` options the fork adds are not in those
types and are declared in `src/verovio/toolkit.ts`.

## Rebuilding

    npm run verovio:build

It needs the fork checked out at `~/Projects/verovio` on branch `aligned-mei` — it refuses
otherwise — and emscripten at `~/emsdk`. Override with `VEROVIO_ROOT`, `EMSDK_ROOT` and
`VEROVIO_BRANCH`.

`src/verovio/toolkit.test.ts` is what says whether the vendored build is the fork and whether it is
recent enough: it asks the toolkit for its own options and fails if the performance group is
missing, or if `performanceBreaks` — which arrived in `a1746b1a9` — is not among them.
