# MPM Desk

Application for interpreting score-aligned performances as [MPM](https://github.com/axelberndt/MPM) and intensity curves.

## Prerequisites

This project depends on two local packages that must be cloned as siblings:

- `../mpmify` — MPM parsing and pipeline
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
