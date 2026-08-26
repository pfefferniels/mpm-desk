# The round trip

Every other test in this repo checks a transformer against what its author expected it to write.
That is why the 2026-08 audit found four criticals behind 78 green tests: all four produced an
MPM that was well-formed, internally plausible and passed every one of them, and were only
visible once the document was **rendered** and the render compared against the performance it
had been fitted to.

That comparison is what lives here.

```
score MSM + truth MPM  ──espressivo──▶  performance P
score MSM + P          ──chain──────▶   fitted MPM
score MSM + fitted MPM ──espressivo──▶  performance P′
                                        assert P′ ≈ P
```

## Why the comparison is in performance space

MPM → performance is many-to-one. A note's velocity can come from `<dynamics>`, from an
articulation's `relativeVelocity`, or from a metrical accentuation; its timing from tempo,
rubato or imprecision. So `fitted MPM ≈ truth MPM` is **not** the property to
assert — the chain is entitled to explain the same performance differently than the truth did.
What it is not entitled to do is render differently.

Parameter-level comparison still earns its place, but only where a case is built to be
_identifiable_: one aspect, exactly representable, segmentation handed in. That is tier 1, and
it is diagnostic — it says _which_ fitter is wrong instead of "the chain is off".

## Why the chain is derived, not chosen

`chainFor` in `harness.ts` builds the transformer list mechanically from the same spec that
produced the truth, and orders it with `compareTransformers` — the registry's own order.

Hand-picking a chain per case is how a synthetic suite quietly starts measuring the person who
wrote it: given freedom over which transformers run and over what windows, almost any fit can be
made to look good. Deriving both sides from one spec removes that freedom. It also means a case
is a statement about the _pipeline_, not about a particular invocation of it.

## The tiers

| File                       | What it holds the chain to                           | What it catches                           |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `tier0-invariants.test.ts` | the structural checks themselves                     | a check that has silently stopped working |
| `tier1-parameters.test.ts` | fitted MPM parameters vs. the truth's                | _which_ fitter is wrong                   |
| `tier2-render.test.ts`     | one aspect, boundaries given, rendered back          | renderer-semantics bugs                   |
| `tier3-endtoend.test.ts`   | several aspects at once                              | interaction bugs                          |
| `aligned.test.ts`          | a real recording and the chain a person wrote for it | what synthesis cannot state               |

Tier 0 is not only its own file: `expectCase` runs `assertWellFormed` on **every** fitted MPM in
tiers 2 and 3. Those checks cost one parse, need no ground truth, and between them cover a
surprising share of the audit — duplicate `xml:id` (#30), `NaN` in an attribute (#44, #45), a
`@name.ref` that resolves to nothing (#28), a `transition.to` with no successor (#24).

## Two ways a synthetic suite lies, and what stops them here

**An inert truth.** A truth MPM the renderer ignores — a dangling `@name.ref`, an unclosed
transition — renders as the bare score. The chain then fits the bare score, the round trip is
perfect, and the case tests nothing. `expectCase` renders each score under an empty MPM first
and requires the truth to differ from it.

**A hand-tuned chain.** Addressed by deriving the chain from the spec, above.

## Bounds

Every case's truth _is_ an MPM document, so it is exactly representable and a correct chain
would round-trip it to zero. **Whatever a bound admits above zero is a measured gap in mpmify**,
and the case's `note` says what causes it. `aligned.test.ts` is the exception and reads its own
bounds differently: its truth is a piano roll, which no MPM need be able to state exactly, so
zero is not the target there and its bounds carry a share-explained figure alongside them.
Tightening a bound is what "fixed" means for the issue it names; loosening one without a reason
is the regression this directory exists to catch.

The bounds carry roughly 25–50% headroom over the measured value, and every one of them was
re-recorded when the suite moved out of espressivo — the chain changed underneath them, so the
figures inherited from there were no longer measurements. `InsertDynamicsInstructions` is the one
fitter left that anneals, and `src/fitting/random.ts` seeds it, so the numbers are stable run to
run: the headroom is for platforms whose floating point sends a chaotic search down a different
path, not for drift.

To re-record after a change:

```sh
ROUNDTRIP_REPORT=1 npx vitest run tests/fitting/roundtrip/report.test.ts
```

## Files

| File              | Role                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `score.ts`        | Score MSMs carrying no performance data — everything expressive must come from the MPM   |
| `truth.ts`        | The ground-truth MPM, as literal XML                                                     |
| `harness.ts`      | The round trip, the derived chain, and the comparison                                    |
| `invariants.ts`   | The structural checks                                                                    |
| `expectations.ts` | What every render-tier case asserts                                                      |
| `cases.ts`        | The coverage matrix and its recorded bounds                                              |
| `pedal.test.ts`   | Pedalling, which is deliberately not a round trip — see the file                         |
| `aligned.ts`      | The same round trip on `tests/fitting/fixtures/roundtrip` — an aligned MEI, no truth MPM |
| `report.test.ts`  | Opt-in: print what every case currently measures                                         |

`truth.ts` deliberately does **not** go through the same writing path as the fit. If it did, a bug
in that path would corrupt both sides equally and the round trip would pass on wrong output. The only code the truth path shares with the code under
test is espressivo's renderer — which is the point: the renderer is the arbiter of what an MPM
document means, and the fit is being measured against that meaning.

## Known violations

A case may declare `knownViolations` — structural checks it currently fails — alongside a `note`
naming the issue. This is asserted as an **exact set**, not a ceiling: a new violation fails, and
so does one that has been fixed but left declared. That keeps the suite green without weakening
the invariant, and makes the declaration something that has to be maintained rather than
something that quietly accumulates.

All three ornamentation cases carry one today, and between them they pin a causal chain:

1. a roll that begins before its beat (the ordinary arpeggio) converts to a `NaN` frame, because
   `TranslatePhysicalTimeToTicks` has no tempo instruction covering a negative time (#26);
2. an ornament that never had a frame is given a `NaN` one anyway, which is what strips the
   gradient-only case;
3. `StylizeOrnamentation.asDef` stamps `@name.ref` on the ornament _before_ its caller decides
   whether to insert the definition, so a skipped definition leaves a dangling reference (#28);
4. and `asDef` guards the `<dynamicsGradient>` with a truthiness test on `transition.to`, so a
   crescendo — whose `transition.to` is `0`, mpmify's own default — loses its gradient entirely
   (#46).

The net effect is that ornamentation does not survive the chain in the common cases. None of it
is visible one transformer at a time.

## What is not covered yet

- **Pedalling is covered, but not as a round trip.** `InsertPedal` takes the movement's shape
  from constructor options rather than fitting it, so a round trip would only measure the option
  values this suite itself chose. `pedal.test.ts` asserts what is left: the movements land on the
  pedal, the document is sound, and the renderer produces an actual sustain stream from it.
- **Tempo.** There is no tempo case any more, and there cannot be one. `ApproximateLogarithmicTempo`
  — the one fitter that read a tempo curve off the onsets — is not part of this application, and
  `InsertTempo` writes down the tempo it is given. `chainFor` therefore hands the truth's own
  tempo map to the chain: every case still has a tempo, as the substrate the aspect under test is
  measured over, but the tempo itself is not under test. The four `tempo:` cases, the
  `discoverBoundaries` mode and the `all five aspects, boundaries withheld` case went with it.
- **Asynchrony.** No case, and no transformer: `InsertAsynchrony` is not part of this
  application either. Every score here also puts its voices in one part, so there would be no
  second part for it to measure against.
- **Multi-part scores.** `buildScore` can put voices in separate parts, but no case does; every
  chord here sits in one part. Nothing in the harness assumes that, so a two-part case is a
  matter of writing one.
- **Real performance data** is covered now, by `aligned.test.ts`, and it measures something
  different from the rest of this directory rather than replacing it. Its truth is a Welte roll
  and its chain is the one a person wrote for that passage, so nothing guarantees a perfect fit
  is available at all — what it holds is that the pipeline still reproduces a performance it has
  been used on. It found a defect on the day it was written — an `<articulation>` covering more
  than one note rendered as nothing, because espressivo reads `@noteid` as a single reference
  while `InsertArticulation` wrote a space-separated list into it (#53, fixed; the case
  _articulation: a chord, every note the same shortening_ now pins it in tier 2 as well).
