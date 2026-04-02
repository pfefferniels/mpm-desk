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
