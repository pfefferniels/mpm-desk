# MPM Desk

An editor for reconstructing a recorded performance as
[Music Performance Markup (MPM)](https://github.com/axelberndt/MPM), and a viewer for reading the
result against the recording. The editor puts a recording note against note with its score and
fits what the two differ by as MPM instructions; the viewer shows the same plots with editing
taken away, so that each curve can be read against the observations it was fitted to.

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
[welte225.org](https://welte225.org/), which holds the only copy, runs the chain over it in the
browser, and opens the editor's desks without the gestures that edit: no drawing, no inserting, no
undo, no saving. Selecting a curve, a frame, a pattern or a press lights the instructions its call
wrote and, in blue, the notes or presses it was fitted to (`Transformer.evidence`).

`/#<call id>`, or an unambiguous prefix of it at least eight characters long, opens the desk that
made the call, on the call's scope, with the call selected and scrolled to. The viewer keeps the
address in step with the call selected, so the URL on screen cites what is on screen; that is
where a call's identifier `https://welte225.org/mpm/<id>` sends a visitor.

`/editor` is the editor. The alignment desk says which sounded event realises which written note,
and writes whatever was played differently into the score (see below); the others plot what the
recording did in one dimension (tempo, rubato, dynamics, accentuation,
articulation, arpeggiation, grace notes, pedalling) and turn a gesture on that plot into a
transformer call. Furthermore there are desks for the document itself (title and author, which MEI
voice goes into which part) and the markup desk, which shows the MPM as text. The same
`#<call id>` opens a call once a project is open.

## What was played differently

A performer of 1905 does not play the text. Notes are added, octaves and inner voices and whole
figures; notes are left out; notes are played at another pitch. The chain fits its instructions
to the notes of the score, so a note the score does not have is a note nothing can be fitted to:
whatever was played differently has to be in the score.

Align therefore transcribes. Every note the performer added is given a place in the bar, a
length, a name and a staff; every note left out is taken out; every note played at another pitch
is written at the pitch played. A tie that was not held is taken away, and the note it ran into
is struck; a note held over where the score strikes it again gets a tie. All of it goes into
`<app>` readings, the source's in `<rdg source="original">` and the performance's in
`<rdg source="performance">`, so that the source is still there and `untranscribed` gives it
back. Nobody is asked first. A reader looks at the result, green for what was played and is not
written, red for what is written and was not played, violet for what was changed, and corrects
what they do not agree with. Clicking a note opens its bar in ordinary notation, where the note
can be written as something else, grace notes or an ornament sign, moved along the bar, made
longer or shorter, or put on the other staff.

What was played is in the score, one way or another: as notes, as grace notes, or as a sign,
and for a sign the reader picks which. There is no way of leaving a played note out, and none
of keeping a note that was not played: the score as it was played has what was played in it
and nothing else.

A recording added on the alignment desk is aligned at once, and whatever a reader then changes
goes into the score by itself, a moment after: there is nothing to press to keep it. The
readings are attributed to the editor named in the work's metadata.

How a place is to be written is a question about how it sounded, so each one can be heard where
it is decided: the bar that opens on a note plays the recording from a second and a half before
the place to two and a half after it, and what sounds lights up in that bar.

Placing an added note is rhythm transcription, with the hard half given: the matched notes on
either side say what the tempo was, and the bars around say what note values the passage moves
in. What is left is a small probabilistic model (`src/alignment/transcription/quantise.ts`,
after Cemgil, Desain and Kappen 2000, Raphael 2002, and Nakamura, Yoshii and Sagayama 2017),
solved exactly, one gap between two matched moments at a time.

How well it does is measured on 32 Chopin rolls of the Stanford University Piano Roll Archive
against the first editions encoded by the Fryderyk Chopin Institute; `scripts/transcription`
says how, and what came out.

One take's alterations are in the score at a time: `<rdg source="performance">` is one reading.

### `AlignSource`

Aligning is the first call of a reconstruction, and the work file says so: one `AlignSource`
call per recording, ahead of everything that fits an instruction. It is the one call made on
the score rather than on the performance, and what it holds is what a reader would want to
check it by:

    source, midi      which <recording>, made from which file
    model             the aligner that put the two against each other
    resolutions       what was decided about each difference, where the reader decided:
                      notes, grace notes, or a sign and which
    edits             each note the reader moved, lengthened or put on the other staff
    resp, certainty   who decided (the work's editor), and how sure
    elements          the xml:ids of the readings it wrote into transcription.mei

Only decisions are recorded. A difference with no entry was written the way the transcriber
writes it unasked, so the file reads as a list of the places where somebody thought otherwise.

The chain does not run the call again. What it wrote is in the score, and the score is what
the archive keeps: aligning afresh on every load would let a later model, or a later version of
the transcriber, change a reconstruction nobody had touched. `untranscribed` takes the readings
out, and Align puts them back with the decisions applied, which is how the desk itself works.

## Export

A project is a zip of

    transcription.mei    the score, with one <recording> per take
    work.json            the reconstruction: the transformer calls, and what each wrote
    performance.mpm      the MPM the chain wrote
    score.msm            the score that MPM is performed against
    recordings/*.mid     the takes

`transcription.mei` is an [as-played-by](https://github.com/pfefferniels/as-played-by) document.
In its `<recording>`s a `<when>` is a note that sounded or a pedal press and nothing else: it
points at a written note and says when that note sounded. What the performer did differently is
in the score, in the readings described above, and the recording points at the notes of the
performance's reading. A written note no `<when>` points at was not played. Several on one note
are that note played as an ornament, each with the pitch that sounded: a figure written as a
sign, the score's own or one a reader chose, is saved that way.

While a reader works, the recording also holds what the aligner could not pair, which is what
lets `untranscribed` take a transcription out again. That working form does not leave the desk.
`src/alignment/transcription/strictRecordings.ts` writes the format's on saving, and a saved
document is read back into the working form from the score alone. Two things do not come back,
because the format has no place for them: that a played note was recognised as a written one
rather than matched by the aligner, and a played note the score had no bar for, such as one
played on a repeat the engraving shows once.

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
| `src/alignment/transcription/` | writing what was played differently into the score |
| `src/verovio/` | the toolkit wrapper and the performed layout |
| `scripts/` | one-shot tools, run with `vite-node` |
| `scripts/transcription/` | the corpus the transcription is measured on, and the measuring |

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
