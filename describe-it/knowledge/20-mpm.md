# REFERENCE 2: WHAT THE MPM INSTRUCTIONS MEAN AND HOW THE RENDERER PLAYS THEM

The renderer is **espressivo 0.13** (TypeScript port of meico's MPM engine, plus MPM v3 ornaments). Everything below was read from its source, the formulas and defaults also checked by test renders; the rest is marked *unverified*.

Conventions. `date` = symbolic score position in ticks at the performance's `pulsesPerQuarter` (MPM Desk: always 720; quarter 720, eighth 360, sixteenth 180). **Which instruction governs a note is decided by the note's symbolic `date`**, never by where it ends up sounding. Velocity is a float on the MIDI scale, clamped to 0..127 only at MIDI export.

## 1. Document structure

```xml
<mpm xmlns="http://www.cemfi.de/mpm/ns/1.0">
 <metadata><author number="0"/><comment/></metadata>
 <performance name="x" pulsesPerQuarter="720">   <!-- name required; ppq default 720 -->
  <global>
   <header>   <!-- collections: tempoStyles dynamicsStyles rubatoStyles articulationStyles
                   metricalAccentuationStyles ornamentationStyles -->
    <articulationStyles><styleDef name="performance_style"><articulationDef name=".." ../></styleDef></articulationStyles>
   </header>
   <dated>    <!-- maps: tempoMap rubatoMap dynamicsMap metricalAccentuationMap articulationMap
                   ornamentationMap movementMap asynchronyMap imprecisionMap.timing|dynamics|toneduration|tuning -->
   </dated>
  </global>
  <part name="" number="1" midi.channel="0" midi.port="0"><header/><dated/></part>
 </performance>
</mpm>
```

- **Global vs. part: no merging.** Per map type, a part performs its own map if its `<dated>` has one (even an empty one), else the global map. A part-level dynamicsMap holding one `<dynamics>` hides the whole global dynamicsMap for that part. `<part>` is matched to the score part by `number`, then `name`. MPM Desk normally writes everything into `<global>`.
- **Span rule.** An instruction is in force from its `date` to the next instruction *of the same element name* in that map, and a `transition.to` runs over exactly that span. So **a transition on the last instruction of a map never progresses**: every ritardando, hairpin or pedal travel must be closed by a following instruction.
- **Styles.** `<style date name.ref="styleName"/>` inside a map selects the `<styleDef>` for name lookups from there on (positional backward scan: it must precede, in document order, what relies on it). The styleDef is looked up in the part's header first, then the global one. MPM Desk: one `<styleDef name="performance_style">` per collection, one `<style date="0" name.ref="performance_style">` heading each map that needs defs.
- **Literal vs. named.** `bpm`, `volume` and their `transition.to` are numbers, or names of a `<tempoDef name value>` / `<dynamicsDef name value>` in the style in scope; an unresolvable non-number silently becomes **100.0** ("p", "mf", "Allegro" have no built-in meaning). `<rubato>` and `<articulation>` take literal attributes, a `name.ref` def, or both (literal wins). `<accentuationPattern>` and `<ornament>` **require** `name.ref`: with no style in scope they are skipped silently; an accentuationPattern whose style exists but whose def does not **aborts the render**.

## 2. Rendering order (per part)

0. Global stage: a *global* ornamentationMap is applied to all parts lacking their own: arpeggio markers go onto chord notes, generated notes (3.6 B) are inserted as real score notes.
1. **dynamics**: a `velocity` for every note.
2. **metrical accentuation**: `velocity += pattern(beat) * scale`.
3. **articulation, tick half**: tick delay, tick duration, velocity (ms modifiers are parked).
4. **rubato**: warps onsets and ends inside frames.
5. **ornamentation**: `velocity +=` gradient; onset `+=` tick offset of the spread.
6. **tempo**: ticks to milliseconds.
7. In milliseconds: **asynchrony**, then **articulation ms** modifiers, then **ornament ms** offsets, then **imprecision**.

Consequences: an arpeggio's tick offsets are not bent by rubato but scale with the local tempo; an articulation tick delay is bent by rubato; dynamics and accentuation ignore all timing maps; pedal curves skip rubato.

## 3. Maps and instructions

### 3.1 `<tempo date bpm beatLength [transition.to] [meanTempoAt]>` in tempoMap

- `bpm` and `beatLength` are required (else the element is ignored). `beatLength` = the beat that `bpm` counts, as a fraction of a whole note: 0.25 quarter, 0.125 eighth, 0.375 dotted quarter, 0.5 half.
- Constant: `ms per tick = 15000 / (bpm * beatLength * ppq)`.
- Transition over `[date, nextTempoDate)`: `T(d) = bpm + x^e * (transition.to - bpm)`, `x = (d - date)/(nextDate - date)`, `e = ln 0.5 / ln(meanTempoAt)`. `meanTempoAt` (default 0.5: e = 1, tempo linear in score position) is the fraction of the span where the tempo is exactly halfway. **< 0.5**: most of the change comes early; **> 0.5**: tempo is held, then changes late (typical final ritardando). `<= 0`: constant at `transition.to`; `>= 1`: constant at `bpm`.
- Time: `ms(d) = 15000/(beatLength*ppq) * integral from date to d of dt/T(t)` (Simpson's rule), accumulated over the instructions, so time is continuous. For e = 1: `ms = 60000 * beats / (to - bpm) * ln(to/bpm)`.
- The tempo itself is **not** continuous: at the next `<tempo>` it jumps to that `bpm`. "A tempo" must be written.
- Defaults: before the first `<tempo>` and for an empty tempoMap, 100 quarter-bpm; **no tempoMap at all: 1 tick = 1 ms**.
- A note exactly on a `<tempo>` date is timed by the *previous* instruction (on the first one: at 100 bpm); this matters only for its displacements. A note displaced to before the start of its governing *transition* is mis-timed (NaN unless the transition is linear).

### 3.2 `<rubato date frameLength [intensity] [lateStart] [earlyEnd] [loop] [name.ref]>` in rubatoMap

- `frameLength` in ticks, required (here or in the `rubatoDef`). Defaults: `intensity` 1, `lateStart` 0, `earlyEnd` 1, `loop` false. `lateStart` is floored at 0, `earlyEnd` capped at 1; `lateStart >= earlyEnd` resets both.
- Warp of a position `d` (onsets and ends alike), `F = frameLength`, `p = (d - date) mod F`:
  `d' = d - p + F * ((p/F)^intensity * (earlyEnd - lateStart) + lateStart)`
- Covers notes dated in `[date, nextRubatoDate)`; with `loop="false"` only the first frame, with `"true"` the frame repeats every F.
- **Frame length is preserved**: with `lateStart = 0` every frame boundary stays put; rubato only redistributes time inside the frame. How long the frame lasts is the tempo map's business.
- `intensity` 1: nothing. **> 1: interior notes come early**: the frame starts hurried and broadens towards its end (2: midpoint sounds at 25 %). **< 1: interior notes come late**: the first note is lengthened and the rest catches up (0.5: midpoint at 70.7 %). For the note at fraction x of the frame to sound at fraction y: `intensity = ln y / ln x`.
- `lateStart`: the frame's first note enters late by `lateStart*F` and the delay is made up inside the frame. `earlyEnd`: the content is over at `earlyEnd*F`, leaving a gap before the next frame (breath).

### 3.3 `<dynamics date volume [transition.to] [curvature] [protraction] [subNoteDynamics]>` in dynamicsMap

- Constant: every note dated in `[date, nextDynamicsDate)` gets `velocity = volume`.
- Transition: `v(d) = volume + s(t) * (transition.to - volume)`, `s(t) = 3t^2 - 2t^3`, where `t` solves `X(t) = (d - date)/(nextDate - date)` (bisection to within 1 tick), `X(t) = ((u*t + v)*t + w)*t`, `u = 3*x1 - 3*x2 + 1`, `v = -6*x1 + 3*x2`, `w = 3*x1`: a cubic Bezier through (0,0), (x1,0), (x2,1), (1,1).
- `curvature` c (clamped 0..1, default 0), `protraction` p (clamped -1..1, default 0): p = 0: `x1 = c`, `x2 = 1 - c`; p > 0: `x1 = c + (1-c)*p`, `x2 = 1 - c*(1-p)`; p < 0: `x1 = c*(1+p)`, `x2 = (1-c)*(1+p)`.
- Shapes: **c = 0 is exactly linear**; c = 0.5 a symmetric S (20 % of the change after a third of the span, 50 % at the middle); c = 1 nearly a step at the middle. **p > 0 postpones** the change (late swell), **p < 0 advances** it (early change, then plateau). MPM Desk's default two-point ramp is `curvature="0.5" protraction="0"`.
- A note exactly on the next `<dynamics>` date takes that element's `volume`. Chain them: next `volume` = previous `transition.to` for a continuous line, a different value for a subito step.
- Defaults: notes before the first `<dynamics>`: 100; no dynamicsMap in part or global: 100; an existing but empty map: no velocity (reads as 100, accentuation then has nothing to add to).
- `subNoteDynamics="true"`: the span becomes a channel-volume curve, notes at 100. Not for piano.

### 3.4 `<accentuationPattern date name.ref scale [loop] [stickToMeasures]>` in metricalAccentuationMap

Def: `<accentuationPatternDef name length>` with `<accentuation beat value [transition.from] [transition.to]>` children.

- `length` in beats (default 4); `beat` 1-based, may be fractional; `transition.from` defaults to `value`, `transition.to` to `transition.from`.
- **A beat is the time signature's denominator unit**: `ticksPerBeat = 4*ppq/denominator` (4/4: 720, 6/8: 360). Time signatures come from the score; none = 4/4.
- Beat of a note: `stickToMeasures="true"` (default): `1 + ((date - tsDate) mod measureTicks)/ticksPerBeat`, restarting at every barline; `"false"`: `1 + ((date - tsDate) mod (length*ticksPerBeat))/ticksPerBeat`. Both count from the date of the time signature in force, not from the instruction.
- Value a(b): 0 before the first accentuation's beat; on an accentuation, its `value`; between accentuation i and the next (after the last: `length + 1`): `from_i + (b - beat_i)/(segmentEnd - beat_i) * (to_i - from_i)`; from `length + 1` on: the last `transition.to`.
- Effect: `velocity += a(b) * scale`; by convention values lie in -1..1 and `scale` is the depth in velocity units.
- `loop` (default false): without it only the first `length` beats after `date` are accentuated and nothing after that until the next instruction; with it the pattern runs on until then.

### 3.5 `<articulation date [noteid] [name.ref] ..modifiers>` in articulationMap

- Target: `noteid="#xmlid"` = that note (always write it). Without it: every note at `date`, and in a part with nothing at that date the *next* note instead.
- Modifiers (on the element and/or an `<articulationDef name ..>`), neutral value in brackets:
  - duration, ticks: `absoluteDuration` (sets), `relativeDuration` (factor, [1]), `absoluteDurationChange` (adds, [0]; halved until the result is positive)
  - duration, ms: `absoluteDurationMs` (end = onset + n; **switches the three tick modifiers off**), `absoluteDurationChangeMs` (adds, [0])
  - onset: `absoluteDelay` (ticks, [0]), `absoluteDelayMs` (ms, [0])
  - velocity: `absoluteVelocity` (replaces), `relativeVelocity` (factor, [1]), `absoluteVelocityChange` (adds, [0])
  - `detuneCents`, `detuneHz`: stored on the note, **not audible** (no pitch bend is written)
- Order: the referenced def first, then the element's own attributes on the result. In a **def** the tick durations compose: `absoluteDuration`, then `* relativeDuration`, then `+ absoluteDurationChange`. On the **element** each is computed from the duration the def left and they overwrite one another (winner: `absoluteDurationChange`, else `relativeDuration`, else `absoluteDuration`). Velocity always composes: `absoluteVelocity`, then `* relativeVelocity`, then `+ absoluteVelocityChange`. Several articulations on one note apply in map order.
- Ms modifiers act after tempo and asynchrony: onset `+= absoluteDelayMs`; end `= onset + absoluteDurationMs` if given; end `+= absoluteDurationChangeMs`; all dropped if end <= onset would result. `absoluteDelayMs` alone moves only the onset (the note shortens).
- `relativeDuration` 1 holds exactly the notated value (to the next notated onset); > 1 overlaps.
- `<style .. defaultArticulation="defName"/>`: that def applies to every note from the switch on that has **no** explicit articulation (an explicit one replaces the default, it is not added to it).

### 3.6 `<ornament date name.ref [scale] [note.order] [noteid] [repetitions]>` in ornamentationMap

Def: `<ornamentDef name [alignment]>` with optional `<dynamicsGradient transition.from transition.to>` and `<temporalSpread frame.offset frameLength [intensity] [noteoff.shift]>`.

**A. Spreading notes the score has (arpeggio, rolled or dislocated chord)**: no `<note>` children, no `repetitions`, no `[ ] |` in `note.order`.

- Slots: `note.order="ascending pitch"` (also the default when absent) or `"descending pitch"` = every note at `date`, by pitch; a global map takes all parts, and a part with nothing at that date contributes its *next* note, so use the explicit form unless every part sounds there. Explicit: `note.order="#id1 #id2 .."` = these notes in this order, other notes untouched. Equal pitches at one date share a slot.
- Frame values carry a unit suffix: `"-90ticks"`, `"120ms"`, `"50%"` (% of the principal's notated duration; principal = the `noteid` note, else the first slot). Defaults `frame.offset="0ticks"`, `frameLength="100%"`. The frame takes the unit of `frameLength`; an offset in the other unit is ignored. (Legacy v2: bare numbers, `frame.start`, `time.unit`.)
- **Onset of slot i of n** (i from 0) relative to the chord's own position: `frame.offset + (i/(n-1))^intensity * frameLength`; the last slot always at `frame.offset + frameLength`; a lone slot at the frame's end. `intensity` 1 even; > 1 early notes bunched (starts fast, broadens); < 1 starts slow, accelerates.
- `frame.offset = 0`: first note on the beat; `= -frameLength`: last note on the beat (roll before the beat). Tick frames follow the tempo, ms frames are absolute.
- `noteoff.shift`: `"false"` (default) only onsets move; `"true"` releases move with them; `"monophonic"` each slot is released as the next begins. `alignment="at end"` anchors the frame at the principal's end.
- **dynamicsGradient**: slot i gets `velocity += scale * (from + i/(n-1) * (to - from))` (one slot: `scale * to`). `transition.from` defaults to 0, `transition.to` to `transition.from`. **`scale` (on `<ornament>`) defaults to 0**: no dynamic effect unless written. MPM Desk keeps the gradient within -1..1 and puts the velocity span in `scale` (from -1 to 0, scale 10: -10 .. 0, a crescendo into the last note struck).

**B. Generating notes (grace notes, trill, turn)**: triggered by `<note xml:id midi.pitch>` children (the pool), `repetitions`, or grouping syntax.
`<ornament date="2160" name.ref="g" noteid="#p" scale="0" note.order="#g1 #g2 #p"><note xml:id="g1" midi.pitch="57"/><note xml:id="g2" midi.pitch="59"/></ornament>`

- `note.order` lists pool notes and the principal as slots (`[ #a #b ]` simultaneous; `|: .. :|` with `repetitions="r"` plays the group r + 1 times), laid out by the same spacing formula; the figure replaces the principal, which sounds at its own slot. `frame.offset = -L`, `frameLength = L`, principal last: graces lead in over L, principal on time. `frame.offset = 0`: principal late by L (grace on the beat).
- `noteoff.shift` here: `"false"` all end at the principal's end; `"true"` each gets the principal's duration; `"monophonic"` each ends at the next, the last at the principal's end (MPM Desk's choice).
- Tick or % frame: the generated notes are real notes at their own tick dates; in a global map they exist before stage 1, so dynamics, accentuation, rubato and tempo treat them like score notes. In a part's own map they appear at stage 5 with the principal's velocity, untouched by rubato. Ms frame: they stay on the principal's date with its velocity and are shifted at stage 7.

### 3.7 `<asynchrony date milliseconds.offset>` in asynchronyMap (implemented)

From `date` to the next `<asynchrony>`, every note of the part is shifted by the offset in ms (negative = early), pedal curves too. Useful only in a `<part>`'s own map (one hand ahead); a global one shifts everything alike. No MPM Desk transformer writes it.

### 3.8 imprecisionMap.timing | .dynamics | .toneduration | .tuning (implemented)

Children `distribution.uniform|gaussian|triangular|correlated.brownianNoise|correlated.compensatingTriangle|list`. Random offsets, added last, to onset and end / velocity / end; tuning only annotates the note (inaudible). They model randomness, not what a performer did: not for describing a recording. Distribution maths *unverified* here.

### 3.9 `<movement date position [transition.to] [curvature] [protraction] [controller]>` in movementMap (implemented)

- `position` 0..1 (0 up, 1 fully down). `controller="sustain"` (default, CC 64) or `"soft"` (una corda, CC 67); **any other name, sostenuto included, goes out as CC 0: unsupported**.
- Without `transition.to` the pedal is at `position` from `date`; with it, it travels to `transition.to` over `[date, next movement)` on the same Bezier as dynamics, but **`curvature` defaults to 0.4**. A missing `position` inherits the previous `transition.to`.
- One map for all controllers: "next movement" is the next element of *any* controller. **The last `<movement>` is never rendered** (it only closes the previous one); movements at negative dates are skipped.
- MPM Desk writes a press as four elements: down (0 to depth), held, up (depth to 0), rest (0); depth < 1 is a partial pedal.

## 4. What "residual" means in MPM Desk

**Onset and duration (ticks).** Each recorded onset is placed on the score grid through the tempo map: take the `<tempo>` covering the note's score date, invert the recorded time elapsed since that segment's start through the tempo curve; the result is `tickDate`. The millisecond cursor is **re-anchored at every tempo boundary on the recorded onset of the note sitting on it**, so one segment's error never leaks into the next. `tickDuration` = the recorded release placed the same way, minus `tickDate`. Then the displacement of every `<rubato>` already in the document is taken back out. What remains, `tickDate - date` and `tickDuration` against the notated duration, is timing nothing has explained yet (material for rubato, articulation or a spread). Undefined where no `<tempo>` covers the note.

**Velocity.** `recorded - rendered`, the rendering being espressivo's own for the current MPM (dynamics, accentuation, articulation). The ornamentation map is **always** held out, because the arpeggio fitters take a chord's stagger and velocity ramp out of the recording itself. A fitter asks with its own map type also held out: "what does everything else leave for me?". *Explained* = residual about zero.

## 5. Glossary: performance vocabulary to MPM

This says which MPM constructs *can* express a term, including ones no call of the chain writes (asynchrony, per-note delays, a part's own map). Which calls to emit for a remark is decided by the table in the first section.

Touch values are indicative starting points, not renderer facts.

| term | MPM |
|---|---|
| ritardando / accelerando | `<tempo bpm=A transition.to=B meanTempoAt>`, B < A / B > A, closed by the next `<tempo>`; late braking = `meanTempoAt` > 0.5 |
| a tempo, piu/meno mosso | a new constant `<tempo>` (tempo never returns by itself) |
| fermata, held note | a low-bpm `<tempo>` over the note and a restoring one after |
| allargando, morendo | tempo transition **and** dynamics transition over the same span |
| pull or drive towards the downbeat / goal note | tempo transition into it + dynamics transition ending on it; if it recurs each bar, an accentuation pattern whose `transition.from/to` ramp rises through the bar |
| agogic accent (lengthened, time made up) | `<rubato>` starting on that note, `intensity` < 1; uncompensated lengthening is tempo |
| delayed, "placed" downbeat; breath | `<rubato>` starting on it with `lateStart` > 0; one late note: `absoluteDelayMs`; a breath before it: `earlyEnd` < 1 on the frame before |
| tempo rubato, borrowed time | `<rubato>`, `frameLength` = the unit within which time is given back (beat, bar, phrase); < 1 lingers then hurries, > 1 hurries then lingers; `loop="true"` if it persists |
| melody rubato over a steady bass | a rubatoMap in the melody's `<part>` (replaces the global one there), or per-note delays |
| notes inégales (inégalité), swing | looped `<rubato>`, `frameLength` = one pair, `intensity = ln r / ln 0.5`, r = first note's share: 0.55: 0.86; 0.6: 0.74; 2/3 (triplet swing): 0.585; 0.75: 0.415; short-long (r < 0.5): > 1 |
| dislocation between the hands | `<ornament>` (3.6 A) over the chord with explicit id order (who leads), `frameLength` = the gap; or `absoluteDelayMs` on the late notes; a persistent lead of one hand: asynchronyMap in its `<part>` |
| arpeggio, rolled chord | `<ornament>` (3.6 A): up `ascending pitch`, down `descending pitch`, irregular = id list; before the beat `frame.offset = -frameLength`, on the beat `0`; speed = `frameLength`; swell = `dynamicsGradient` + `scale` |
| acciaccatura, grace figure | `<ornament>` (3.6 B): `<note>` pool, `noteid` = principal, principal last in `note.order`; before the beat `frame.offset = -L`, on the beat `0` |
| trill, turn, tremolo | 3.6 B with a repeat group and `repetitions` |
| voicing, melody brought out | per note `<articulation noteid relativeVelocity>` or `absoluteVelocityChange`; within a chord an `<ornament>` whose def has only a `dynamicsGradient`; a whole voice: its own `<part>` and dynamicsMap |
| hairpin | `<dynamics volume transition.to curvature protraction>` closed by the next `<dynamics>` |
| subito piano / forte | next `<dynamics>` `volume` different from the previous `transition.to` |
| sforzato, accent, fp | `<articulation noteid absoluteVelocityChange="+n">`; fp adds a lower `<dynamics>` right after |
| metrical (good-bad) accentuation | `<accentuationPattern loop="true">` + def: strong beats positive, weak negative, `scale` = depth |
| staccato, staccatissimo | `relativeDuration` about 0.5, 0.25; or `absoluteDurationMs` for a fixed short sound |
| portato / tenuto / legato | `relativeDuration` about 0.75 / 1 (full value) / 1; for a whole passage `defaultArticulation` |
| overlapping legato, finger pedal | `relativeDuration` > 1, or `absoluteDurationChange(Ms)` > 0 |
| pedal, half pedal, half change | `<movement controller="sustain">`; half pedal: `position` about 0.3..0.7; half change: travel to a partial position and back to 1 without reaching 0; una corda: `controller="soft"` |
