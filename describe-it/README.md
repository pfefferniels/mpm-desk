# DescribeIt!

A prototype of another way into the MPM Desk: a reader describes a recorded performance in their
own words, on its piano roll, and never has to know MPM.

The roll draws the louder note taller, so that a loud note stands out of its own track into the
ones beside it. The reader writes on the roll as on paper: a stroke along it brackets a passage,
a stroke down it boxes some of its notes, a click picks a note, and with nothing in hand what is
typed is about the whole piece. An expert, Claude Opus 5.5, reads each remark ("arpeggio
throughout", "steady tempo on half bars", "this note was presumably played quieter", "pull
towards the downbeat") and turns it into calls to the fitting chain. The chain runs again, and
the roll is redrawn as **what the MPM as it stands leaves unexplained**: a rolled chord that has
become a `<temporalSpread>` stands as one onset, a passage whose tempo has been described falls
onto the score's grid, a note whose loudness is accounted for is one row tall. Where a remark
took something out of a note itself, the stagger of a roll or the give of a rubato, the note as
it was played stays behind as a shadow. A tempo leaves none: it is the ruler the notes are laid
against, and moves a note and its shadow alike.

It is published as a Claude artifact, where the page asks Claude through the viewer's own
account. Opened anywhere else it draws and fits, and a remark's calls can be written by hand.

## What is here

| | |
|---|---|
| `engine.ts` | The chain of `src/fitting`, run for a roll of residuals. Nothing of it is reimplemented; what is added is listed below. |
| `engine.worker.ts` | The engine as the page loads it: a worker, or a global where a worker cannot start. |
| `index.html`, `app.js` | The page: the roll, the pencil, the remarks, the expert's prompt. |
| `knowledge/` | What the expert is told: how a remark becomes calls (`00`), every transformer with its options (`10`), what every MPM instruction means to the renderer (`20`). |
| `examples.json` | The two remarks the page opens with, translated in advance. |
| `build.ts` | Writes `dist/`: the bundled engine, the piece, the published calls for comparison, the knowledge joined. |

    WELTE225=../welte225.org npx vite-node describe-it/build.ts

The piece is the published transcription of WM 225 with its base text chosen. `dist/` is not
committed.

## What the engine adds to the chain

A reader who draws a tempo hands over a number; one who says "steady on half bars" does not. And
a remark made today may be about a place somebody spoke of yesterday.

- **`FitTempo`** reads a tempo off the recorded onsets, steady or moving, over one span or cut
  into steps, and makes the `InsertTempo` call a drawn line would have made. **`FitDynamics`**
  does the same for a level, **`FitSpread`** rolls the chords of a passage, and **`Repeat`**
  writes one call per step of a span.
- **Assumptions.** A tick position exists only under a `<tempo>` and a velocity residual only
  against a `<dynamics>`, so where nothing has been said the engine assumes a steady tempo
  joining what is described on either side, and one level. They are reported apart, and the page
  draws their bar lines dashed.
- **A later remark owns its place.** A tempo or dynamics span is taken out of every earlier one,
  which is refitted over what it has left; a roll on one chord goes before a roll over all.
- **What a desk always writes** is filled in, an ornament gets its definition unasked, and a call
  that cannot run is left out and reported while the rest still run.

`tests/describe-it/engine.test.ts` holds it to that, over the published transcription: with
nothing described the roll is the recording, and with the published reconstruction replayed
through it what is left of the timing falls by more than fifty times.

## What it does not do yet

- The expert is not given the score's own markings (fermatas, hairpins, slurs), only the notes.
- Tempo, rubato, dynamics and accentuation are written for both hands; one hand's share is said
  through note ids.
- Remarks are kept in the browser's own storage, and nothing is played back.
- A `work.json` can be saved from the page, a fitted step stated as the call it came to; opening
  it in the editor has not been tried.
