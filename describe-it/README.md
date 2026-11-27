# DescribeIt!

A prototype of another way into the MPM Desk: a reader describes a recorded performance in their
own words, on its piano roll, and never has to know MPM.

The roll draws the louder note taller, so that a loud note stands out of its own track into the
ones beside it. The reader writes on the roll as on paper: a stroke along it brackets a passage,
a stroke down it boxes some of its notes, a click picks a note, and with nothing in hand what is
typed is about the whole piece. An expert, Claude Opus 5.5, reads each remark ("arpeggio
throughout", "steady tempo on half bars", "this note was presumably played quieter", "pull
towards the downbeat") and turns it into calls to the fitting chain.

The roll is on the recording's clock. Its notes are what the MPM as it stands renders, and
behind each stands its shadow, the same note as it was played, which never moves. With nothing
described the notes are the bare score at one tempo and one level, and the shadows show all the
pianist did: beside a note where the tempo is off, taller than it where a loudness is not
accounted for, staggered under a chord the MPM has not yet rolled. After every remark the chain
runs again and the notes go to their new places, and where a note covers its shadow there is
nothing left to see. The bar lines stand where the tempo as it stands puts them, dashed where it
is only assumed.

The roll can be heard: as it was played, as the MPM has it, or both at once, the playing to the
left and the MPM to the right. With a passage or some notes in hand, those are played by
themselves; otherwise the roll plays from the line a click on nothing leaves. The four numbers
above the roll say how far the notes still are from their shadows, in timing, within chords, in
loudness and in length.

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
- **Assumptions.** A rendering needs a `<tempo>` and a `<dynamics>` everywhere, so where nothing
  has been said the engine assumes a steady tempo joining what is described on either side, and
  one level. They are reported apart, and the page draws their bar lines dashed.
- **The rendering, against the recording.** The renderer's own performance of the MPM, laid on
  the recording's clock the way the chain places a tempo: anew on the chord each tempo begins on,
  so that what one stretch gets wrong is not carried into the next.
- **The pedal, for playing back.** The presses as they were recorded and the moves the MPM's
  rendering makes, on the one clock.
- **A later remark owns its place.** A tempo or dynamics span is taken out of every earlier one,
  which is refitted over what it has left; a roll on one chord goes before a roll over all.
- **What a desk always writes** is filled in, an ornament gets its definition unasked, and a call
  that cannot run is left out and reported while the rest still run.

`tests/describe-it/engine.test.ts` holds it to that, over the published transcription: with
nothing described the rendering is one tempo and one level, and with the published
reconstruction replayed through it the rendering stands fifty times nearer the playing.

## What it does not do yet

- The expert is not given the score's own markings (fermatas, hairpins, slurs), only the notes.
- Tempo, rubato, dynamics and accentuation are written for both hands; one hand's share is said
  through note ids.
- Remarks are kept in the browser's own storage.
- What is played back is a plain synthesized string, there to tell early from late and loud from
  soft, not to sound like the instrument.
- A `work.json` can be saved from the page, a fitted step stated as the call it came to; opening
  it in the editor has not been tried.
