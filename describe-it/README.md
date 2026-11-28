# DescribeIt!

A prototype of another way into the MPM Desk: a reader describes a recorded performance in their
own words, on its piano roll, and never has to know MPM.

The roll is laid over a grand staff: two compact staves set apart, every note a box on the staff
it is written on, on its line or in its space, with ledger lines, the key signature, and an
accidental where a note departs from it. It can be put back key by key. The louder note is drawn
taller and more solid, so that a loud note stands out of its place and a soft one is pale. The reader writes on the roll as on paper: a stroke along it brackets a passage,
a stroke down it boxes some of its notes, a stroke from one note to another is an arrow, a
direction the playing takes, a click picks a note, and with nothing in hand what is typed is
about the whole piece. An expert, Claude Opus 5.5, reads each remark ("arpeggio
throughout", "steady tempo on half bars", "this note was presumably played quieter", "pull
towards the downbeat") and turns it into calls to the fitting chain.

The roll is on the recording's clock. Its notes are what the MPM as it stands renders, and
behind each stands its shadow in gray, the same note as it was played, which never moves. With nothing
described the notes are the bare score at one tempo and one level, and the shadows show all the
pianist did: beside a note where the tempo is off, taller than it where a loudness is not
accounted for, staggered under a chord the MPM has not yet rolled. After every remark the chain
runs again and the notes go to their new places, and where a note covers its shadow there is
nothing left to see. The bar lines stand where the tempo as it stands puts them, dashed where it
is only assumed.

Under the keys are the pedals, in the same manner: a press as it was recorded is a shadow, and
what the MPM moves is solid.

The roll can be heard on a sampled piano: as it was played, as the MPM has it, or both at once,
the playing to the left and the MPM to the right. With a passage or some notes in hand, those are played by
themselves; otherwise the roll plays from the line a click on nothing leaves. One figure above
the roll says how well the MPM matches the playing; under the pointer it opens into the four it
is made of, how far the notes still are from their shadows in timing, within chords, in loudness
and in length.

A remark the pointer rests on is played brought out: its passage alone, with the instructions it
wrote exaggerated, every other dimension of the performance held back, and a pianist's inner
voice humming along. A slider sets how strongly. The exaggeration is espressivo's, which works on
whole dimensions (tempo, dynamics, rubato and so on) rather than on single instructions; playing
only the passage is what keeps it to the remark. The voice is the idea of welte225.org's front
page in small: the line of its hand-made reduction, each note sung when the piano note it comes
from is struck. There it is VocalTractLab that sings; here it is a hum made with the browser's
own audio, which is plainer.

It is published as a Claude artifact, where the page asks Claude through the viewer's own
account. Opened anywhere else it draws and fits, and a remark's calls can be written by hand.

## What is here

| | |
|---|---|
| `engine.ts` | The chain of `src/fitting`, run for a roll of residuals. Nothing of it is reimplemented; what is added is listed below. |
| `engine.worker.ts` | The engine as the page loads it: a worker, or a global where a worker cannot start. |
| `index.html`, `app.js` | The page: the roll, the pencil, the remarks, the expert's prompt. |
| `staff.js` | Spelling and staff positions: where a pitch sits on a staff, its ledger lines, the key signature read off the notes. |
| `voice.js` | The inner voice: the sung line of a passage in time with a performance, and a hum for it. |
| `reduction.ts` | Reads the line that is hummed from the site's `hummed/reduction/reduction.mei`, at build time. |
| `player.js`, `piano.js` | Playing back: a transport over struck keys, and the piano it plays, which is the Salamander samples struck as `@tonejs/piano` strikes them in the Desk. |
| `knowledge/` | What the expert is told: how a remark becomes calls (`00`), every transformer with its options (`10`), what every MPM instruction means to the renderer (`20`). |
| `examples.json` | The two remarks the page opens with, translated in advance. |
| `build.ts` | Writes `dist/`: the bundled engine, the piece, the published calls for comparison, the knowledge joined. |

    WELTE225=../welte225.org npx vite-node describe-it/build.ts

The piece is the published transcription of WM 225 with its base text chosen. With a checkout of
the whole site the build also writes `reduction.json`, the line the inner voice hums; with the
published files alone it writes an empty one, and nothing is hummed. The build also
fetches the piano's samples into `dist/piano/`, which the page can load from nowhere but beside
itself. `dist/` is not committed.

Piano samples: Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0, in the mp3 conversion of
`@tonejs/piano` (Yotam Mann, MIT).

## What is kept of a remark

The reader's words, what they were said about, the calls they became, the model that translated
them and the date. Not why: the expert gives no account of its reading. In the list of steps a
remark is itself a step, `Describe`, which changes nothing and names the calls that came of it,
so that the list stays flat:

    { "id": "r1", "name": "Describe", "options": { "text": "steady tempo on half bars",
      "about": { "kind": "span", "from": 720, "to": 23760, "notes": [] },
      "model": "claude-opus-5-5", "date": "2026-11-27T12:00:00.000Z", "calls": ["r1:0", "r1:1"] } }
    { "id": "r1:0", "name": "InsertTempo", "options": { ... } }

`Describe` is a transformer of the Desk's registry (`src/fitting/transformers/description`), so
the Desk reads such a list as it reads any other. No desk shows a remark yet: a link to one opens
the desk of the document itself.

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
- **The pedals.** The presses as they were recorded and the moves the MPM's rendering makes, on
  the one clock.
- **A remark brought out.** A run's MPM rendered with the dimensions of one remark's instructions
  exaggerated and the others damped, on that rendering's own clock.
- **The record.** Every step as the Desk reads it, a fitted step stated as the call it came to,
  under the Desk's `Describe` step for the remark it came from.
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
- A `work.json` can be saved from the page. The Desk knows every step in it; opening one there
  has not been tried.
- `app.js` is one long file still. The transport and the piano are modules of their own, and the
  rest is to follow them.
