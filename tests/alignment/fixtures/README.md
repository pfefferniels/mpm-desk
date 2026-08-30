# Score fixtures from real repertoire

Four short excerpts of published piano music, converted to MEI by verovio, kept
here because the two MEI files the repository already had contain no grace note,
no arpeggio and no ornament at all. Between them they hold every construct that
makes verovio's played onsets differ from the onsets the score writes, and one
that makes it read the wrong pitch altogether, so `getNotesFromMEI`,
`applyNotatedOnsets` and `impliedAlterations` can be pinned against music rather
than against a hand-built probe.

Each fixture ships as a pair: the file the excerpt was cut from, and the MEI
verovio made of it. The source is here so the MEI can be re-derived, and because
it is the authority on what the excerpt sounds like — MusicXML and Humdrum both
state pitch outright, which MEI does not.

## Provenance

| fixture | source | measures |
| --- | --- | --- |
| `chopin-op38-mm18-22` | Chopin, Ballade op. 38 — Vienna 4x22 corpus, `musicxml/Chopin_op38.musicxml` | 18–22 |
| `chopin-op38-mm40-46` | same | 40–46 |
| `mozart-kv279-mm30-35` | Mozart, Sonata K. 279/i — Batik plays Mozart, `scores/kv279_1.musicxml` | 30–35 |
| `chopin-op9-mm1-6` | Chopin, Nocturne op. 9 no. 1 — NIFC Humdrum edition of Kistner, Leipzig, `009-1-KI-001.krn` | pickup–6 |

The three MusicXML fixtures were converted with verovio `6.4.0-aligned-mei` built from fork
commit `7e8d5ce` — **not** the build now under `vendor/verovio`, which is later. Re-deriving them
with the vendored build reproduces the committed note tables exactly, all 86, 113 and 146 rows of
them; `fixtureProvenance.test.ts` is what says so, and will say otherwise if a rebuilt verovio
ever imports MusicXML differently.

```js
const toolkit = new VerovioToolkit(await createVerovioModule())
toolkit.loadData(musicXml)                       // verovio imports MusicXML
writeFileSync(out, toolkit.getMEI({ pageNo: 0, scoreBased: true }))
```

`chopin-op9-mm1-6` goes through the same call, but the vendored build carries no
Humdrum importer, so it was converted with the released `verovio@6.3.0`
(`npm pack verovio@6.3.0`, then its `verovio-module-hum.mjs`) — the build that
made the full file it was cut from. The Humdrum excerpt is lines 1–147 of the
source, which is everything up to the `=7` barline, closed with a `*-` terminator
and the trailing `!!!` reference records. Verovio numbers a note after the token
it came from, `note-L{line}F{field}`, so keeping the line numbering intact makes
every id in the excerpt the id that note has in the full file: all 141 notes carry
the same id, pitch name, octave and accidental there as here.

Cutting an excerpt carries the `<attributes>` and the `<sound tempo>` in force at
the first kept measure into it, and drops the half of any slur or wedge whose
partner fell outside the cut. Without the tempo verovio falls back to 120 bpm,
which changes how much time it gives a grace note.

The two op. 38 excerpts have one `<staves>2</staves>` added to the carried
`<attributes>`. The Vienna 4x22 Chopin sources declare two clefs and put
`staff="2"` on notes but never say how many staves the part has, so verovio
folds the whole piano texture onto one staff and emits 83 warnings over the full
piece. Adding the element silences every warning and leaves the note table
bit-identical — same ids, onsets, durations and pitches in both `notatedOnsets`
modes.

`chopin-op38-mm18-22` needed a second repair, in both halves of the pair. The
Vienna 4x22 corpus carries no `<accidental>` element anywhere: it states what a
note sounds as, in `<alter>`, and never what the page prints. That is enough for
every altered note, because verovio writes an `<alter>` out as `@accid.ges` — but
it loses a note that is *cancelled* by an accidental, because a natural in
MusicXML is the absence of `<alter>` and verovio then writes nothing at all. The
four B naturals of mm. 19 and 21, in a key signature of one flat, came through as
plain `<note pname="b">`, which in MEI is a B flat. They have their
`<accidental>natural</accidental>` back in the MusicXML and the `@accid="n"` it
converts to in the MEI. Re-deriving the MEI from the repaired MusicXML with the
call above reproduces the committed note table exactly. Nothing else in any
excerpt was edited.

## What is in them

All four are well-formed, every `xml:id` is a valid NCName, and no id repeats.

| | mm18-22 | mm40-46 | kv279 | op9 |
| --- | --- | --- | --- | --- |
| measures / staves | 5 / 2 | 7 / 2 | 6 / 2 | 7 / 2 |
| `<note>` | 87 | 119 | 146 | 141 |
| `<chord>` | 1 | 1 | 6 | 0 |
| grace notes (`@grace`) | 2 (`unacc`) | 8 (1 `unacc`, 7 `acc`) | 2 (`acc`) | 0 |
| `<tie>` | 1 | 6 | 0 | 1 |
| ties starting on a grace | 0 | 6 | 0 | 0 |
| `<arpeg>` (all with `@plist`) | 0 | 0 | 2 | 0 |
| `<trill>` | 0 | 0 | 1 | 0 |
| `<tuplet>` | 0 | 0 | 0 | 2 |
| `<slur>` | 3 | 3 | 10 | 19 |
| written accidentals | 4 | 0 | 17 | 25 |
| `@accid.ges` | 1 | 17 | 8 | 0 |
| rows from `getNotesFromMEI` | 86 | 113 | 146 | 140 |

The round trip is lossless for the three MusicXML pairs: MusicXML and MEI hold the
same number of notes, graces, ties, arpeggios and trills, every note keeps the
`id="nN"` the MusicXML gave it — so the table joins to partitura's note array note
by note — and, since the repair above, every note sounds at the pitch its
MusicXML states.

## The behaviour each one pins

Measured against `ScoreTable.from_musicxml` on the same source, matched on id.

**`mozart-kv279-mm30-35`** — what `notatedOnsets: true` is for. Both arpeggios
are rolled by verovio and both grace notes push their principal aside; the
correction puts all of them back. Arpeggio members agreeing with partitura go
from 2/6 to 6/6, the one grace principal from 0/1 to 1/1, and nothing that was
right becomes wrong. All 137 plain notes agree in both modes.

**`chopin-op38-mm40-46`** — the acciaccatura chain that closes the piece, six
graces each tied into a sustained principal, plus one `unacc` grace in m. 41.

- m. 41 is the good case: the grace displaces its principal, and the correction
  hands it back exactly — onset 3.035 → 3.0 and duration 0.715 → 0.75, both
  partitura's numbers.
- m. 46 is the case no correction touches. Verovio does *not* merge the tie:
  each `*main` note sounds from the notated 18.0 to 21.0 while its grace sounds
  after it, at 18.035 … 18.211. `getNotesFromMEI` drops every note that is a tie
  `@endid`, so the six principals are thrown away and the table keeps six graces
  of 0.035 quarters each. partitura reads the same six notes as onset 18.0,
  duration 3.0. `notatedOnsets: true` changes none of it.

**`chopin-op38-mm18-22`** — the case `notatedOnsets: true` makes worse. Both
graces here are `unacc` with a note before them in the same layer, so verovio
lays them over the tail of that note and leaves the principal where the score
writes it. `restoreGracePrincipals` moves the principal back to the grace's
onset all the same, taking two notes that agreed with partitura (4.5 and 10.5)
away from it (4.465 and 10.465).

**`chopin-op9-mm1-6`** — what `impliedAlterations` is for, and the one fixture
whose pitches are not already right without it. The Humdrum edition writes its
accidentals the way a score prints them: `bb-` is a B flat, but the flat is in the
signature, so verovio's converter emits `<note pname="b" oct="5"/>` with no
accidental at all — the file holds not one `@accid.ges`. Verovio then sounds it as
B natural, because `Note::GetChromaticAlteration` reads the note's own accidental
and nothing else. 70 of the 141 notes are affected, and the excerpt comes out in
something like C major rather than B flat minor. The kern is the authority: it
states pitch outright, and `note-L{line}F{field}` joins it to the MEI token by
token, so `test/accidentals.test.ts` can check all 140 rows against it.

Against its own recording the full piece went from 711 of 1728 notes matched to
1682, with the surviving 46 deletions and 48 insertions being ordinary divergence
between a score and a performance of it. The two other NIFC sources of the same
nocturne behave the same way.
