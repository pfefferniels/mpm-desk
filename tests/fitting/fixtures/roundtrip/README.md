# The aligned fixture

An excerpt of a real reconstruction, in the repo so that `tests/fitting/roundtrip/aligned.test.ts` can
run the whole pipeline on a performance no MPM produced. Issue #51 asked for it; until then the
only inputs the pipeline had ever run on lived in `mpm-desk` and were never copied.

| File | What it is |
|---|---|
| `traeumerei.mei` | Schumann, *Träumerei* — the upbeat and the four bars of the opening phrase, aligned to Welte-Mignon roll 225 (Alfred Grünfeld) |
| `chain.json` | The reconstruction's own transformer calls, restricted to those bars |
| `alignment.msm` | The MEI's alignment, frozen: the score and the recording in MSM's own attributes |
| `alignment.pedals.json` | The recorded pedals, which MSM cannot state |
| `alignment.sources.json` | Which reading each `<note>` came from, which MSM cannot state either |

## What it carries

58 notes with an alignment, of which the MSM conversion folds two into their longer twins, so 56
reach the comparison. The alignment is in `<performance>`: one `<when>` per note per recording,
carrying `absolute`, a `duration` and a `velocity`, which is what mpmify's `scripts/bake/asMSM.ts` reads.

Both of the MEI's recordings are kept — the same roll read twice — because the chain opens with
`MakeChoice`, and with one recording there would be nothing to choose. Ten pedal `<when>`s fall
inside the excerpt's window.

`chain.json` is a work file: a `provenance` of 84 calls, and 20 `segments` that group them by
call id and say why. The calls are 15 `InsertTemporalSpread`, 12 `InsertPedal`, 11
`InsertMetricalAccentuation`, 10 `InsertTempo`, 10 `InsertRubato`, 9
`InsertDynamicsInstructions`, 8 `InsertArticulation`, 3 `Modify`, and one each of `MakeChoice`,
`InsertDynamicsGradient`, `TranslatePhyiscalTimeToTicks` (the misspelling the registry has an
alias for), `StylizeOrnamentation`, `MergeMetricalAccentuations` and `InsertMetadata`. That is
every aspect the issue asked the fixture to exercise, plus pedalling.

Each segment's `elements` is empty. It is filled in on export from what the calls created, and
the bake derives its own from a run rather than reading it back.

## The frozen alignment

`alignment.*` is the same alignment mpmify's `scripts/bake/asMSM.ts` builds from the MEI, stated as
documents. It exists because `asMSM` reads a vocabulary private to this project —
`extData[type="duration"]`, `extData[type="velocity"]`, an `absolute` with an `ms` suffix — and
the accuracy suite must be readable without it.

The three files are one triple. `Alignment.serialize()` writes the score and the recording
together into `alignment.msm`, and the two things it cannot carry go beside it:

- **pedals.** MSM's `<pedal>` is `date`/`state`/`date.end` in ticks, and a recorded pedal has no
  symbolic date at all.
- **sources.** `source` — which reading of the passage a note came from, what `MakeChoice`
  selects on — is not an MSM attribute. One entry per `<note>` of the document, in document
  order; `id` is a checksum, not a key, because a note both readings sound is two `<note>`
  elements under one `xml:id`.

112 `<note>` elements under 56 ids, 10 pedals under 5 ids: the excerpt is aligned twice.
`MakeChoice` is what reduces it to one reading, and it runs in the test rather than here.

## Where it came from

Cut on 2026-08-25 from `mpm-desk/public/transcription.mei` and `mpm-desk/public/info.json`, the
inputs the bake was written for. The rule was mechanical, so that the excerpt is a slice of that
reconstruction rather than a selection from it:

- **the score** — the first five `<measure>` elements in document order. *Träumerei* is written
  out with its repeats, so that is the upbeat plus bars 2–5 and not the five bars numbered 1–5;
  it ends at tick 12240. A control event left pointing outside the excerpt — one `<slur>`, one
  `<pedal>` — was dropped with it.
- **the alignment** — every `<when>` whose `@data` still resolves, and every pedal `<when>`
  between one second before the first onset and the last.
- **the chain** — every call whose `from`/`to`/`date` is inside the excerpt and whose `noteIDs`
  or `pedal` still resolve, plus the calls that carry no range at all. A
  `MergeMetricalAccentuations` naming a pattern that did not survive was dropped too.

`info.json`'s `secondary` block, which holds the desk's tempo clusters, is not part of what the
pipeline reads and was left out.

## Regenerating it

The MEI and `chain.json` have no script: with the source outside this repo a checked-in one
could not be run here anyway, and the excerpt is meant to be stable — the recorded bounds in
`aligned.test.ts` are measurements of *this* passage. Cutting a longer one means redoing the
three steps above and re-recording the bounds against the result.

`alignment.*` does, because it is derived rather than cut:

    npx vite-node scripts/bake/writeAlignment.ts   # in mpmify, which is where the bake lives

It runs `asMSM` over the MEI and refuses to write unless the triple reads back as the alignment
`asMSM` built. Touching the MEI's `<performance>` means re-running it.
