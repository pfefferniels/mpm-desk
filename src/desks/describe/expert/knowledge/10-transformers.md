# REFERENCE 1: THE TRANSFORMERS OF THE CHAIN

This is the MPM Desk's chain as it stands in its code, option by option. The describe desk's run wraps it; where a note beginning **In the describe desk:** says otherwise, the note holds. Which steps a remark becomes is decided by the table in the first section, not here.

You emit steps `{"name": <transformer>, "options": {...}}`. A step that names a transformer is a call of it, and what is said of a call below is said of that step. **[v]** = checked by running the chain. REAL = options verbatim from the published reconstruction of Welte roll 225 (447 calls; each heading gives its count; that piece has a quarter upbeat, then 4/4 bars from tick 720).

## 0. Rules for every call

- **Options are taken whole.** A call's `options` replace the transformer's options; the chain merges no defaults, so a missing field is `undefined` at run time. **In the describe desk:** the run fills in the options listed in the first section and refuses, with a message, a step that lacks a number it needs. State an option when you mean something by it.
- **Map/Set options** are `InsertDynamics.guides`, `InsertPedal.guides` (Map) and `InsertArticulation.aspects` (Set). In a work file they are envelopes: `{"dataType":"Map","value":[[k,v],...]}`, `{"dataType":"Set","value":[...]}`. **In the describe desk:** a plain object (`{"1440": 33}`) or array (`["relativeDuration"]`) is accepted as well.
- Nothing validates values: `null` or a string for a number is written into the MPM as text. A computed `NaN`/`Infinity` in an attribute throws.
- **Never emit** `InsertMetadata`, `TranslatePhysicalTimeToTicks`, `RoundNumbers` (injected into every run), `AlignSource` (a document call, applied to the score before any chain) or `Describe` (the remark itself, which writes nothing). Unknown names are reported and skipped.
- Most failures are silent no-ops. **In the describe desk:** a step whose call throws is reported, what could not run is left out, and the rest still run.

## 1. The chain model

**Alignment.** `allNotes[]`: `xml:id`, `part` (1-based), `staff`, `layer`, `date`, `duration` (ticks), `midi.pitch`, `velocity` (0-127), `milliseconds.date` (onset), `milliseconds.date.end` (absolute release, not a length), optional `source` (take); an unsounded note has a non-finite onset. `pedals[]`: `xml:id`, `type` `'sustain'|'soft'`, the two ms fields, optional `travel`, `source`; **no tick date**. `graces[]`: recorded grace notes with `group` (the `graceGrp` id), `principal` (note id), `date` (the principal's). `timeSignatures[]`: `{date, numerator, denominator}`. A **chord** = all notes of a scope on one `date`. `noteIDs`, `pedal`/`pedalIDs` and `group` in options are these `xml:id`s and `group`s verbatim.

**Ticks.** 720 per quarter, 2880 per whole. `beatLength` is a fraction of a whole note: 0.25 = 720 ticks, 0.125 = 360, 0.5 = 1440, 0.375 = 1080.

**Scope.** `'global'`, or a 0-based part index `n` = notes with `note.part === n + 1`, written into MPM `<part number="n+1">`; `note.part` is the staff number unless `ProcessVoices` re-lays it out. A part's map of one kind **replaces** the global map of that kind for that part: one `InsertDynamics` with `scope: 0` cuts part 1 off from all global dynamics **[v]**. Every scoped published call is `'global'`; do likewise unless you build a part's whole map. No scope at all: `MakeChoice` (default form), `CorrectPedal`, `InsertPedal`, both `Stylize*`, `ProcessVoices`.

**Order.** Each run rebuilds the MPM from empty, in this registry order, however the calls are listed:

1. `ProcessVoices`: every later scope query filters on `note.part`.
2. `MakeChoice`: leaves one row per note.
3. `CorrectPedal`, 4. `Modify`: correct the recording (ms) before anything is fitted.
5. `InsertDynamicsGradient`, 6. `InsertTemporalSpread`: the gradient reads a chord's strike order, which the spread destroys.
7. `InsertTempo`: sees rolled chords already collapsed to one onset. Last to rewrite the recording.
8. `InsertRubato`, 9. `CombineAdjacentRubatos`: read where notes fall on the tick grid under the tempo.
10. *(injected hinge: ornament frames ms -> ticks, using tempo and rubato)*
11. `StylizeOrnamentation`: gives ornaments their definitions.
12. `InsertDynamics`: sees velocities the gradients have flattened.
13. `InsertMetricalAccentuation`, 14. `MergeMetricalAccentuations`: what dynamics leave unexplained.
15. `InsertArticulation`, 16. `StylizeArticulation`, 17. `MakeDefaultArticulation`: what tempo+rubato (durations) and dynamics+accentuation (velocity) leave.
18. `InsertPedal`. *(then injected metadata and `RoundNumbers`, 4 decimals)*

**Among calls of one transformer:** `precedence()` first (`Modify`: expansions before shifts; `InsertTemporalSpread`: chord rolls before grace figures; others equal), then ascending `options.from` where both have a numeric one (`InsertTempo`, `InsertDynamics`, `InsertMetricalAccentuation`, ranged `Modify`/`MakeChoice`), else the order written. **In the describe desk:** `FitTempo` and `FitDynamics` stand where the `InsertTempo` and `InsertDynamics` they write do; every tempo, fitted, given in numbers or assumed, runs by its `from` in the order of the score, and so does every dynamics. A roll over every chord is written out chord by chord, as a `FitSpread` is, and a pedal line over every press, press by press.

**`requires`** (in the MPM Desk a miss stops the run. **In the describe desk:** the tempo and level the run assumes count as `InsertTempo` and `InsertDynamics`, so the first of these is always met and the step runs; but the document holds no assumption, so what such a step came to is withheld from it, and reported as withheld, for as long as no call of the document meets the requirement. Any other miss leaves out only the step that has it): `InsertMetricalAccentuation` needs any `InsertDynamics`; `MergeMetricalAccentuations` needs `InsertMetricalAccentuation`; `CombineAdjacentRubatos` needs `InsertRubato`; `StylizeArticulation` needs `InsertArticulation`. (`InsertArticulation`, `MakeDefaultArticulation`, `InsertPedal` require the hinge, always present.)

**Residuals.** Later fitters read "recorded minus what the MPM so far explains", their own dimension held out:
- *Tick position / tick duration*: a note's recorded onset and release converted through the tempo map, fitted rubato taken off. Exists only under a `<tempo>`. The conversion starts at 0 ms on the first `<tempo>` and re-anchors on the recorded onset of the note on each later tempo boundary. So **[v]**: the first tempo must start on the first sounded note's date, or its whole segment is displaced; a wrong `bpm` skews positions inside its own segment only.
- *Velocity residual* = recorded minus rendered (dynamics x accentuation x articulation; no ornaments). Before the first `<dynamics>` the renderer assumes **100**, so the residual is garbage there **[v]**. **In the describe desk:** the run always has a tempo from tick 0 and a level in force, so neither case arises.
- Any residual throws while notes stand on more than one take.

| Fits its numbers itself | Writes the numbers you hand it |
|---|---|
| `InsertTemporalSpread`, `InsertDynamicsGradient` (scale), `InsertRubato`, `InsertDynamics` (unless guides override), `InsertMetricalAccentuation`, `InsertArticulation`, `MakeDefaultArticulation`, `InsertPedal` without guides, both `Stylize*` | `InsertTempo` (bpm, transitionTo, meanTempoAt), `Modify`, `CorrectPedal`, `InsertPedal` guides/ramp, `InsertDynamics.guides`, `InsertDynamicsGradient.gradient`, `MakeChoice`, `ProcessVoices` |

## 2. The transformers

### ProcessVoices (0)
`{parts: {number: int >= 1, name: string, voices: string[]}[], moves?: {part: number, select: {noteIDs: string[]} | {voice: string, from: tick, to: tick}}[]}`. A voice key is `"<staff>/<layer>"`; a voice move covers `[from, to)`. One call holds the **whole** layout. Rewrites `note.part` (moves override voices, later moves win), names the MPM parts, writes no instruction. `number - 1` is the scope other calls then use. Faulty layouts are only logged. Shape: `{"parts":[{"number":1,"name":"melody","voices":["1/1"]},{"number":2,"name":"rest","voices":["1/2","2/1"]}],"moves":[]}`.

### MakeChoice (1)
Default: `{prefer: source}` or `{velocity: source, timing: source, pedalling: source}`. Ranged: the same plus `scope` (ignored) and `from`,`to` (ticks, inclusive) or `noteIDs: string[]`. A source is a take's `@source` (`"#take-<uuid>"`). Keeps the `timing` take's row of each note with the `velocity` take's velocity and deletes the others; graces likewise. **Every call filters the pedals of the whole piece** down to its `pedalling`/`prefer` source: a misspelt source chooses nothing and deletes all pedals, and two calls preferring different takes delete all pedals **[v]** (give a ranged call the three-key form with `pedalling` = the default take). List ranged calls before the default one. REAL: `{"prefer":"#take-c9050e75-97a8-4862-9533-0f4b1439802b"}`.

### CorrectPedal (0)
`{pedal: id, travel: Travel}` (redraw; onset stays, release follows the line) | `{pedal: id, remove: true}` | `{pedal: newId, type: 'sustain'|'soft', onsetMs: number, travel: Travel, source?: string}` (add). `Travel = [{ms: integer >= 0, position: 0..1}, ...]`: >= 2 vertices, `ms` strictly rising from 0, last `position` 0; a position holds until the next vertex. Edits `pedals` only. Malformed travel or adding an existing id: logged no-op. Shape: `{"pedal":"pedal-9f1c","type":"sustain","onsetMs":5000,"travel":[{"ms":0,"position":1},{"ms":900,"position":0}]}`.

### Modify (34: 33 shifts, 1 expansion, all `velocity`)
`scope`, `aspect: 'velocity'|'onset'|'duration'`, at most one selector: `noteIDs: string[]` | `pedalIDs: string[]` | `from`,`to` (ticks, inclusive, notes of the scope). No selector = every note of the scope, plus every pedal for `onset`/`duration` under `'global'`. Then either **shift** `change: number` (velocity steps, or ms) or **expansion** `points: [recorded, new][]` (>= 2 pairs, recorded values strictly rising; linear between, outer lines extended).
`velocity`: floored at 0, no ceiling, may turn fractional. `onset`: moves onset and release together, not below 0 ms; an expansion measures ms from the first note's onset. `duration`: moves the release, not before the onset. Corrects the recording, writes no instruction; every later fit and every dynamics guide is on the corrected values. Expansions run before shifts; shifts add up. Logged no-ops: `velocity` with `pedalIDs`, unknown aspect, bad points. Moving the *earliest* onset moves the zero of the whole recording **[v]**.
REAL: `{"scope":"global","aspect":"velocity","points":[[35,20],[54,46]]}`; `{"from":16920,"to":18360,"scope":"global","aspect":"velocity","change":-6}`; `{"scope":"global","aspect":"velocity","change":-6,"noteIDs":["ntu78d0"]}`. Published changes: -2 (15), -4 (9), -6 (7), -10 (2); 22 of 29 ranges have `from` = `to` (one chord). Timing (not published): `{"scope":"global","aspect":"onset","change":-40,"noteIDs":["n1"]}`.

### InsertDynamicsGradient (1)
`scope`, `sortVelocities: boolean`, and `date: tick` + `gradient: {from, to}` (one chord) or `crescendo: {from, to}` + `decrescendo: {from, to}` (every chord with >= 2 notes). Ends in [-1, 1] and unequal, else it **throws**.
Reads the chord's velocities in recorded strike order (crescendo if the loudest is struck after the quietest). Fits `scale = (lastVel - firstVel) / (to - from)` and the *standard velocity* `firstVel - from * scale`; writes `<ornament date scale note.order>` and **sets every note of the chord to the standard velocity**, which is what `InsertDynamics` sees. The desk's `crescendo {-1,0}`, `decrescendo {0,-1}` make the standard the louder end; `{0,1}` keeps the first-struck note's velocity. `sortVelocities: true` first redeals the velocities monotonically along the strike order. No-op: unknown date, one note, first = last velocity. The first call to reach a chord wins **[v]**: list per-chord calls before the default. **In the describe desk:** a gradient said of one chord stands in place of its share of one said of every chord, in whichever order they come. REAL: `{"scope":"global","crescendo":{"from":-1,"to":0},"decrescendo":{"from":0,"to":-1},"sortVelocities":true}`. Per chord (not published): `{"scope":"global","date":4320,"gradient":{"from":-0.5,"to":0.5},"sortVelocities":false}`.

### InsertTemporalSpread (98: 97 per-chord, 1 graces)
Roll: `scope`, `placement: 'on-beat'|'before-beat'|'estimate'|'none'`, `noteOffShiftTolerance: number` (in the type, **never read**; desk writes 2), and `date: tick` (one chord) or `durationThreshold: ms` (every chord spread wider than it; desk 35). Grace figure: `scope` + `group: string`, or `scope` + `graces: 'all'`.
Roll: reads the ms onsets and releases of the chord's sounded notes (>= 2); fits frame length (last minus first onset), spacing `intensity` (3+ notes), `noteoff.shift`, `note.order`. `placement` says where the beat is and so **which onset the whole chord is rewritten to for all later fits**: `on-beat` = the first note's, `before-beat` = the last note's, `estimate` = the mean, `none` = skip.
Grace figure: reads the group's `graces` and its principal's onset; writes its own `<ornament noteid>`; leaves the recording alone. Skipped while the group has two readings or its principal was not struck.
Frames are measured in ms; the hinge makes them ticks if a `<tempo>` **of the same scope** covers the date, else they stay ms (valid) **[v]**. Silent until `StylizeOrnamentation` runs, which **in the describe desk** the run adds.
Pitfalls **[v]**: a per-date call running after a `durationThreshold` call on the same chord measures a collapsed chord and overwrites the frame with length 0: list per-date calls first, never two for one date. Without `date` and `durationThreshold` every chord is rolled. **In the describe desk:** a roll said of one chord stands in place of its share of a roll over every chord, in whichever order they come, and a roll over every chord without `durationThreshold` takes the desk's 35.
REAL: `{"scope":"global","placement":"before-beat","noteOffShiftTolerance":2,"date":1440}`; `{"scope":"global","graces":"all"}`. Placements: before-beat 48, estimate 32, on-beat 17. All chords (not published): `{"scope":"global","placement":"estimate","noteOffShiftTolerance":2,"durationThreshold":35}`.

### InsertTempo (62)
`scope`, `from: tick`, `to: tick` (exclusive), `bpm: number`, `beatLength: number`, optional `transitionTo: number`, `meanTempoAt: number` (0..1; 0.5 is written if `transitionTo` comes without it).
**Fits nothing**: writes `<tempo date=from bpm beatLength [transition.to meanTempoAt]>` as given; `bpm` = beats of `beatLength` per minute. Also subtracts the earliest onset from every note, pedal and grace.
`to` is **not written**. A tempo, and a transition's curve, lasts until the *next* `<tempo>` (or the score's end); `to` only removes existing tempos with `from <= date < to` **[v]**. So tile: each `to` = the next `from`; a transition followed by a gap keeps bending across the gap. If a call removes the tempo in force at its `to` and nothing stands there, that tempo's `bpm` is written back at `to` as a constant; so never two calls with one `from` or overlapping ranges, or that constant is carried from boundary to boundary (the published MPM ends in such a stray `<tempo date="91440">`).
Curve: `tempo(x) = bpm + x^(ln 0.5 / ln meanTempoAt) * (transitionTo - bpm)`, x = fraction of the tick span. `meanTempoAt` is where the tempo is halfway: 0.5 linear, smaller = the change comes early, larger = late. `<= 0` renders as constant `transitionTo`; `>= 1`, or `transitionTo == bpm`, as constant `bpm`.
The numbers must make the segment last as long as the recording took between the onsets on `from` and `to`, or every tick position in it is skewed. Start calls on dates that have a note.
REAL: `{"from":16560,"to":18360,"bpm":48.15044403076172,"beatLength":0.25,"scope":"global","transitionTo":61.15050506591797,"meanTempoAt":0.53984375}`. Constant (none published): `{"scope":"global","from":0,"to":2880,"bpm":54.2,"beatLength":0.25}`. Published: all are transitions, `beatLength` 0.25, bpm 28-85, transitionTo 9.5-89, meanTempoAt 0.02-0.95; spans 1440 (26), 720 (10), 1080 (7), up to 5040; contiguous 0..91440.

### InsertRubato (56)
`scope`, `date: tick`, `length: tick`; frame `[date, date + length)`.
Reads the tick positions (rubato held out) of the chords in the frame, averaged per chord. Fits `intensity` (0.1..5) and, where the chord on `date` is late, `lateStart` (0..0.9); writes `<rubato date frameLength intensity loop="false" [lateStart]>`. Warp: `performed = x^intensity`, x = position in the frame; the frame's ends stay on the grid, so time is redistributed *inside*. `intensity < 1`: notes inside come late (lingering on the frame's start, then hurrying on; long-short inégalité; agogic lengthening of the first note). `> 1`: notes inside come early (hurrying off the start, broadening before the end).
Pitfalls: no tempo over a note of the frame: logged no-op **[v]**. The fit goes by **index, not date**: it assumes frame start, chords and frame end are evenly spaced, so pick frames the onsets divide evenly (a quarter of two eighths, a half bar of four). A frame holding only the chord on its start fits `intensity = 1`, i.e. nothing **[v]**. An *early* first chord cannot be expressed. Two calls on one frame write two `<rubato>`.
REAL: `{"scope":"global","date":19440,"length":720}`. Published: every `length` 720, one call per beat.

### CombineAdjacentRubatos (0)
`scope`, `intensityTolerance: number`, `compressionTolerance: number` (desk 0.2 / 0.2). Folds back-to-back frames of equal length into the first (`loop="true"`, values averaged) where they bend the same way and differ by less than the tolerances; a neutral `<rubato>` ends the loop. For "the same swing throughout"; it would average away a rubato that grows or fades.

### StylizeOrnamentation (1)
`tickTolerance: number` (ticks: frame start and length), `intensityTolerance: number`, `gradientTolerance: number`. All required: `{}` throws **[v]**. Clusters the ornaments of every scope (>= 2 members, equal note-off behaviour), writes a shared `<ornamentDef>` of mean values per cluster and a private one per loner, and points each `<ornament>` at its def. A chain with any `InsertTemporalSpread` or `InsertDynamicsGradient` needs exactly one. **In the describe desk:** the run adds it; do not emit it. REAL: `{"tickTolerance":8,"intensityTolerance":0.3,"gradientTolerance":0.1}` (desk 10 / 0.3 / 0.1).

### InsertDynamics (61)
`scope`, `from: tick`, `to: tick` (inclusive), `guides: Map<tick, velocity>`.
Points: per chord date the mean recorded velocity (after `Modify` and gradient flattening); **a guide replaces the chord mean on its date** or adds a point where no chord is. Only points in `[from, to]` count; guides outside are ignored (the desk hands every call its whole guide set).
Writes one `<dynamics>`: `date` = first point's date (not `from`), `volume` = first point's value, `transition.to` = last point's value, `curvature`/`protraction` fitted to the points between. **The two ends are taken, not fitted**: a guide on the first or last date states a level. One point, or equal ends, gives a constant. A transition is closed by `<dynamics date=lastPoint volume=target>` unless an instruction stands there.
A level holds until the next `<dynamics>`. Contiguous calls share the boundary date; the later one fills its curve into the closing instruction and **keeps the volume already there**, so give both the same guide on a shared boundary. Overlaps are not resolved (the later instruction cuts the earlier curve short). No point in range: no-op.
REAL: `{"scope":"global","guides":{"dataType":"Map","value":[]},"from":35280,"to":37440}`; `{"from":16920,"to":18000,"guides":{"dataType":"Map","value":[[18000,11]]},"scope":"global"}`. A level on one date (not published): `{"scope":"global","from":1440,"to":1440,"guides":{"dataType":"Map","value":[[1440,33]]}}`. Published: ranges tile 0..91440; spans 360-3600, mostly 1440 (21), 1080 (14); guide velocities 11-38.

### InsertMetricalAccentuation (50)
`scope`, `name: string`, `from: tick`, `to: tick`, `beatLength: number`, `scaleTolerance: number`, `neutralEnd?: boolean`.
`[from, to]` is **one cell** = one cycle; make `to - from` a multiple of `beatLength * 2880`. Reads the velocity residual, averaged over the notes exactly on each `from + k * beatLength * 2880`, `to` included (that last sample only says what the last beat ramps towards). Fits `scale` = largest |residual| sampled and per beat an `<accentuation value>` = residual / scale, ramping linearly to the next; `neutralEnd: true` lets the last beat ramp to 0. Writes `<accentuationPatternDef name>` and `<accentuationPattern date=from name.ref scale stickToMeasures="false">`.
Then it tries the following cells of equal length: while their rounded beat values match and their scale is within `scaleTolerance` of the first, the pattern is extended (`loop="true"`, scale averaged) and a `neutral` pattern is written where the run stops. `0` = this cell only (in practice); larger = "while it repeats". A pattern that does not loop sounds for its one cell only **[v]**.
Pitfalls: needs an `InsertDynamics` in the chain (else throws) whose dynamics really cover the cell. `name` unique per scope, not `"neutral"`: a second def of one name **replaces** the first and both instructions follow it **[v]**. An earlier looping pattern may drop its neutral closer inside a later call's cell. No notes on the sampled dates: no-op.
REAL: `{"from":16920,"to":18000,"beatLength":0.125,"name":"pattern-034da7c8","scaleTolerance":1.5,"neutralEnd":true,"scope":"global"}`. Published: `beatLength` always 0.125; cells 720 (35), 1800 (8), 1080 (6), 1440 (1); `scaleTolerance` 1.5 (30), 0 (18), 1 (2); `neutralEnd` true in 49.

### MergeMetricalAccentuations (4)
`scope`, `names: string[]`, `into: string`. Averages the named pattern defs beat by beat (the first decides the beats), replaces them by one def `into`, repoints their instructions (each keeps its `scale`). Fewer than two existing names: no-op. REAL: `{"names":["pattern-4dea1044","pattern-3d185551","pattern-c4d748e1"],"into":"good-bad-4x","scope":"global"}`.

### InsertArticulation (26)
`scope`, `noteIDs: string[]`, `name: string`, `aspects: Set<'relativeDuration'|'relativeVelocity'|'absoluteDuration'|'absoluteDurationChange'>`.
Per note: `relativeDuration` = sounded tick duration / notated; `absoluteDuration` = sounded ticks; `absoluteDurationChange` = sounded minus notated ticks; `relativeVelocity` = recorded velocity / velocity the MPM renders. Writes **one** `<articulationDef name>` with the **mean of each chosen aspect over all the notes**, and one `<articulation date noteid name.ref>` per note: one call = one kind of articulation; notes that differ need separate calls.
Pitfalls: duration aspects need a tempo over the note, `relativeVelocity` needs dynamics; an unmeasurable aspect is silently left out; an empty Set writes an inert def. `name` unique (same-name defs replace each other), not `"default articulation"` or `def_<n>`. `scope`: `'global'` or the note's own part.
REAL: `{"scope":"global","noteIDs":["n1wi1vv4-rend2","n6knmhg-rend2"],"aspects":{"dataType":"Set","value":["relativeDuration"]},"name":"01981525-c000-4831-8ee6-d728ab4864bb"}`. Published: `relativeDuration` 23, `absoluteDuration` 1, `relativeVelocity` 1, both relative 1; 1-6 notes; names are UUIDs.

### StylizeArticulation (0)
`volumeTolerance: number`, `relativeDurationTolerance: number` (desk 0.01 / 0.2). Clusters only articulations whose def states **both** relative aspects and no absolute duration; each cluster shares a `def_<n>`, the largest becomes the map's `defaultArticulation` and loses its instructions. After the usual one-aspect calls it changes nothing.

### MakeDefaultArticulation (0)
`{scope}`. Mean `relativeDuration` of all notes of the scope no `<articulation>` names, written as def `"default articulation"` and made the map's default. The general touch. Needs tempo.

### InsertPedal (50, all guided)
Always the **global** `movementMap`; no scope.
- **Trace** `{}` (every press) or `{pedal: id}`: fits `<movement>`s to each press's recorded line on the tick grid (a switch = two constants; a traversal = one transition with fitted bend). Needs tempo, else writes nothing.
- **Guided** `{pedal: id, guides: Map<tick, position 0..1>}`: two guides at different positions are a ramp, equal neighbours a hold. Needs no tempo; unknown press: logged no-op.
- **Ramp** (legacy) `{pedal?, start: ticks from the press's onset ('down') or release ('up'), duration: ticks, direction: 'up'|'down', depth?: 0..1}` (depth 1 if absent).

Ids are `<pedal>_down/_held/_up/_rest`: two calls reaching one press write duplicates **[v]**, so one call per press or one `{}`. **In the describe desk:** a line said of one press takes the place of an earlier one of that press and stands against one said of every press, so no press is written twice. REAL: `{"pedal":"sustain-36000","guides":{"dataType":"Map","value":[[35350.4125,0],[35550.4125,1],[36948.5723,1],[37248.5723,0]]}}`. Published: always 4 guides (rest, down, held, rest), depth mostly 1 (else 0.5-0.9), ramps of 90-300 ticks.

## 3. How the MPM Desk's own desks arrive at option values (for the typical values only)

- **Tempo.** A skyline of boxes, one per inter-onset interval, height `60 / seconds`. The user draws a line whose ends snap to recorded onsets; then `fitMeanTempoAt` (shape of the stroke), `inferBeatLength`, `findOnsetTick` (both ends) and `optimizeForElapsedTime` with `targetMs` = the recorded time between the two onsets, which bends `meanTempoAt`, or else scales both bpm, until the segment lasts as played. `transitionTo` and `meanTempoAt` are written iff the two bpm differ by > 0.01.
- **Rubato.** Two clicks on chord dates: `date` = the earlier, `length` = the distance. **Pedal.** >= 2 guides per press, whole ticks, position to 0.01. **Articulation.** Clicked notes, ticked aspects, `name` a UUID.
- **Dynamics.** Guides pencilled on a grid (1/2 to 1/16 from tick 0), integer velocity; a drag between two anchors (chord or guide dates) gives `from`, `to`.
- **Accentuation.** Click start, click end = the cell; new cells get `beatLength: 0.125, scaleTolerance: 0, neutralEnd: true, name: "pattern-<8 hex>"`; a dialog offers `beatLength` 0.5 to 0.0625 and `scaleTolerance` 0..5.
- **Arpeggiation.** Chord + placement (initially `estimate`), or "Insert Default" with threshold 35. Gradient: a handle picks the standard velocity, `gradient = gradientThrough(standard, rampVelocities(chord, sortVelocities))`.
- **Corrections.** Click = `noteIDs`, shift-click = `from`/`to`, pedals = `pedalIDs`; a drag is the `change`, a dialog the `points`, an edited press line a `CorrectPedal`. **Choice / Voices.** Menus of takes; one `ProcessVoices` edited in place.
