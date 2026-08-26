import type { Case } from './harness';
import { QUARTER } from './score';

/**
 * The coverage matrix.
 *
 * Every case's truth is **exactly representable in MPM** — it *is* an MPM document — so a
 * perfect chain would round-trip it to zero error. Whatever a bound admits above zero is a
 * measured gap in mpmify, and `note` says what causes it. Tightening a bound is what "fixed"
 * means for the issue it names; loosening one without a reason is the regression this file
 * exists to catch.
 *
 * Bounds are in milliseconds (onset, duration) and MIDI velocity units.
 */

const END = 7 * QUARTER;
const EIGHT_BEATS = { beats: 8 };

/** A tempo map every case can borrow: constant, so it contributes nothing to the error. */
const STEADY_TEMPO = [{ date: 0, bpm: 120 }];

export const tierTwoCases: Case[] = [
  // The four `tempo:` cases that used to open this file are gone with
  // `ApproximateLogarithmicTempo`. They measured a fit of a tempo curve to the onsets it
  // produced; `InsertTempo` is handed the curve, so the same case would only measure the
  // writer. Every case below still carries a tempo — see `chainFor` — but as the substrate the
  // aspect under test is measured over.
  //
  // Every bound in this file was re-recorded against that chain, so they are measurements
  // again and the ratchet still means something. Three moved: the rubato-only case and
  // `tempo + rubato` collapsed towards zero, and `all five aspects at once` traded all of its
  // onset error for more duration error. Each says so on the row.
  {
    name: 'dynamics: constant',
    score: EIGHT_BEATS,
    truth: { tempo: STEADY_TEMPO, dynamics: [{ date: 0, volume: 70 }] },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { max: 0.5 } },
  },
  {
    name: 'dynamics: linear crescendo 40 to 100',
    score: EIGHT_BEATS,
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [
        { date: 0, volume: 40, 'transition.to': 100, curvature: 0, protraction: 0 },
        { date: END, volume: 100 },
      ],
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { mean: 0.8, max: 1.8 } },
  },
  {
    name: 'dynamics: curved diminuendo',
    score: EIGHT_BEATS,
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [
        { date: 0, volume: 110, 'transition.to': 45, curvature: 0.4, protraction: 0.3 },
        { date: END, volume: 45 },
      ],
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { mean: 0.9, max: 2.6 } },
  },
  {
    name: 'dynamics: two segments, swell then fall',
    score: { beats: 17 },
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [
        { date: 0, volume: 45, 'transition.to': 105, curvature: 0, protraction: 0 },
        { date: 8 * QUARTER, volume: 105, 'transition.to': 55, curvature: 0, protraction: 0 },
        { date: 16 * QUARTER, volume: 55 },
      ],
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { mean: 0.9, max: 1.9 } },
  },
  {
    name: 'articulation: one legato for every note',
    score: EIGHT_BEATS,
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      articulation: {
        defs: [{ name: 'legato', relativeDuration: 1.3 }],
        defaultArticulation: 'legato',
      },
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { max: 0.5 } },
  },
  {
    name: 'articulation: a chord, every note the same shortening',
    // The case #53 needed and no other case here provides: notes that share a date *and* an
    // articulation unit. `InsertArticulation` used to fold those into one instruction
    // carrying `noteid="#a #b #c"`, which names no note at all — so every articulation on a
    // chord was inert, and the whole chord rendered at its written length. Every other
    // articulation case is monophonic, which is why 78 green tests never saw it.
    score: { beats: 8, pitches: [60, 64, 67] },
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      articulation: {
        defs: [{ name: 'staccato', relativeDuration: 0.5 }],
        defaultArticulation: 'staccato',
      },
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { max: 0.5 } },
  },
  {
    name: 'articulation: alternating relativeVelocity 1.4 / 0.7',
    score: EIGHT_BEATS,
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      articulation: {
        defs: [
          { name: 'loud', relativeVelocity: 1.4 },
          { name: 'soft', relativeVelocity: 0.7 },
        ],
        pattern: ['loud', 'soft'],
      },
    },
    // Issue #23 is fixed, and this bound is *not* what is left of it: with one articulation
    // unit per note the round trip is exact, which tier 1 asserts to six decimals. What
    // remains is the averaging. `InsertArticulation` writes one ratio per unit — the mean of
    // its notes — and the fitted dynamics curve here is a descending ramp (the fitter sees
    // the alternation as a diminuendo), so the notes in one unit sit at different points on
    // it and their `recorded/prescribed` ratios differ. One average cannot satisfy all of
    // them. That is an ordering problem, not an arithmetic one: dynamics is fitted before
    // articulation is known.
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { mean: 26, max: 55 } },
  },
  {
    name: 'articulation: alternating relativeDuration 1.4 / 0.5',
    score: EIGHT_BEATS,
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      articulation: {
        defs: [
          { name: 'long', relativeDuration: 1.4 },
          { name: 'short', relativeDuration: 0.5 },
        ],
        pattern: ['long', 'short'],
      },
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { max: 0.5 } },
  },
  {
    name: 'rubato: one looping frame, intensity 0.7',
    score: EIGHT_BEATS,
    truth: {
      tempo: STEADY_TEMPO,
      rubato: [{ date: 0, frameLength: 4 * QUARTER, intensity: 0.7, loop: true }],
    },
    // **Exact, and it was not.** This case used to admit mean 105 / max 260 ms of onset error
    // with nothing but rubato in the truth, and its note said why: the tempo fitter ran first,
    // over onsets the rubato had already warped, and explained them as an accelerando — over a
    // window 1.75 frames long a steady 120 came back as 54 → 128. Take the tempo fitter out of
    // the chain and the whole of that error goes with it. It was never the rubato fitter's.
    //
    // That is the clearest thing this suite says about the move: fitting tempo and rubato in
    // sequence was the defect, and this row is what it cost.
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { max: 0.5 } },
  },
  {
    name: 'accentuation: 4/4 metrical pattern',
    // Nine beats, not eight: a metrical cell is one bar and its last sample is the *next*
    // bar's downbeat, so a piece that stops mid-bar leaves the final cell unable to close.
    score: { beats: 9 },
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      accentuation: {
        date: 0,
        name: 'metre',
        length: 4,
        scale: 1,
        loop: true,
        accentuations: [
          { beat: 1, value: 20 },
          { beat: 2, value: 4 },
          { beat: 3, value: 12 },
          { beat: 4, value: 0 },
        ],
      },
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { max: 0.5 } },
  },
  {
    name: 'ornamentation: rolled chords',
    // Three notes to a beat, so there is a chord to roll at all.
    score: { beats: 4, pitches: [60, 64, 67] },
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      ornamentation: {
        defs: [
          {
            name: 'roll',
            temporalSpread: {
              'frame.start': -250,
              frameLength: 500,
              'time.unit': 'milliseconds',
              intensity: 1,
            },
          },
        ],
        instructions: [
          { date: 0, 'name.ref': 'roll' },
          { date: 2 * QUARTER, 'name.ref': 'roll' },
        ],
      },
    },
    // Both rolls survive now, and the fitted frame is exact: -360 ticks over 720, which is
    // -250 ms over 500 at this tempo. What is left is the renderer's, not mpmify's.
    //
    // espressivo performs any ornament frame that *begins* before the first <tempo> at its
    // no-tempo default of 100 bpm, ignoring the tempo map for that frame entirely — measured
    // by rendering one frame at 60, 100 and 120 bpm and getting 600 ms every time, while the
    // identical frame one bar later gives 1000, 600 and 500. So the roll on beat 1 comes out
    // 20% wide here and the roll at 1440 comes out exact.
    //
    // mpmify could match that by converting pre-piece frames at 100 bpm, and should not: it
    // would bake one renderer's fallback into the document and mean something else anywhere
    // else. The 50 ms is recorded rather than fitted away.
    note:
      'espressivo renders a frame beginning before the first <tempo> at its 100 bpm ' +
      'default, whatever the tempo map says',
    bounds: {
      onset: { mean: 11, max: 60 },
      duration: { mean: 11, max: 60 },
      velocity: { max: 0.5 },
    },
  },
  {
    name: 'ornamentation: velocity gradient across the chord',
    score: { beats: 4, pitches: [60, 64, 67] },
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      ornamentation: {
        defs: [
          {
            name: 'ramp',
            dynamicsGradient: { 'transition.from': -1, 'transition.to': 0 },
          },
        ],
        // @scale gates the gradient entirely — without it the def performs nothing and
        // this case would round-trip a plain chord. See the note on the field.
        instructions: [
          { date: 0, 'name.ref': 'ramp', scale: 25 },
          { date: 2 * QUARTER, 'name.ref': 'ramp', scale: 25 },
        ],
      },
    },
    // Exact. This case used to lose the gradient entirely — an ornament with a ramp and no
    // roll was given a NaN frame by the tick translation, then discarded by the clustering,
    // which keys on the frame. It now keeps its ramp and gets a definition of its own.
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { max: 0.5 } },
  },
  {
    name: 'ornamentation: a roll that also swells',
    score: { beats: 4, pitches: [60, 64, 67] },
    truth: {
      tempo: STEADY_TEMPO,
      dynamics: [{ date: 0, volume: 64 }],
      ornamentation: {
        defs: [
          {
            name: 'roll',
            temporalSpread: {
              'frame.start': -250,
              frameLength: 500,
              'time.unit': 'milliseconds',
              intensity: 1,
            },
            dynamicsGradient: { 'transition.from': -1, 'transition.to': 0 },
          },
        ],
        instructions: [
          { date: 0, 'name.ref': 'roll', scale: 25 },
          { date: 2 * QUARTER, 'name.ref': 'roll', scale: 25 },
        ],
      },
    },
    // Exact in velocity. This case came back mirrored — 64/51.5/39 against a truth of
    // 39/51.5/64 — for two reasons that had to be fixed together, and each of which hid the
    // other. The registry ran the spread before the gradient, so the gradient read its
    // direction off onsets the spread had just collapsed (#32); and the clustering's merge
    // read the two `transition.*` one index short of where they sit, so a correctly fitted
    // ramp was reversed again on its way into the definition.
    //
    // The onset bound is the renderer behaviour described on the rolled-chords case above.
    bounds: {
      onset: { mean: 11, max: 60 },
      duration: { mean: 11, max: 60 },
      velocity: { max: 0.5 },
    },
  },
];

/**
 * The truth both "all five aspects" cases below share. They differ in exactly one thing —
 * whether the chain is handed the segmentation — so the gap between their bounds is what
 * knowing the boundaries is worth.
 */
const EVERYTHING = {
  tempo: [
    { date: 0, bpm: 105, 'transition.to': 78, meanTempoAt: 0.5 },
    { date: 8 * QUARTER, bpm: 78, 'transition.to': 96, meanTempoAt: 0.5 },
    { date: 16 * QUARTER, bpm: 96 },
  ],
  dynamics: [
    { date: 0, volume: 48, 'transition.to': 98, curvature: 0.2, protraction: 0 },
    { date: 8 * QUARTER, volume: 98, 'transition.to': 60, curvature: 0, protraction: 0 },
    { date: 16 * QUARTER, volume: 60 },
  ],
  rubato: [{ date: 0, frameLength: 4 * QUARTER, intensity: 0.6, loop: true }],
  accentuation: {
    date: 0,
    name: 'metre',
    length: 4,
    scale: 1,
    loop: true,
    accentuations: [
      { beat: 1, value: 14 },
      { beat: 2, value: 2 },
      { beat: 3, value: 8 },
      { beat: 4, value: 0 },
    ],
  },
  articulation: {
    defs: [
      { name: 'loud', relativeVelocity: 1.3, relativeDuration: 1.15 },
      { name: 'soft', relativeVelocity: 0.8, relativeDuration: 0.65 },
    ],
    pattern: ['loud', 'soft'],
  },
};

export const tierThreeCases: Case[] = [
  {
    name: 'tempo + dynamics',
    score: EIGHT_BEATS,
    truth: {
      tempo: [
        { date: 0, bpm: 110, 'transition.to': 75, meanTempoAt: 0.5 },
        { date: END, bpm: 75 },
      ],
      dynamics: [
        { date: 0, volume: 50, 'transition.to': 100, curvature: 0, protraction: 0 },
        { date: END, volume: 100 },
      ],
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { mean: 0.9, max: 2 } },
  },
  {
    name: 'tempo + dynamics + alternating articulation',
    score: EIGHT_BEATS,
    truth: {
      tempo: [
        { date: 0, bpm: 110, 'transition.to': 75, meanTempoAt: 0.5 },
        { date: END, bpm: 75 },
      ],
      dynamics: [
        { date: 0, volume: 50, 'transition.to': 100, curvature: 0, protraction: 0 },
        { date: END, volume: 100 },
      ],
      articulation: {
        defs: [
          { name: 'loud', relativeVelocity: 1.35, relativeDuration: 1.2 },
          { name: 'soft', relativeVelocity: 0.75, relativeDuration: 0.6 },
        ],
        pattern: ['loud', 'soft'],
      },
    },
    // A moving dynamics curve under a per-note articulation: the same averaging limit as
    // the tier-2 case above, now with a curve that moves for a second reason.
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { mean: 17, max: 35 } },
  },
  {
    name: 'tempo + rubato',
    score: EIGHT_BEATS,
    truth: {
      tempo: [
        { date: 0, bpm: 100, 'transition.to': 80, meanTempoAt: 0.5 },
        { date: END, bpm: 80 },
      ],
      rubato: [{ date: 0, frameLength: 4 * QUARTER, intensity: 0.65, loop: true }],
    },
    // Re-recorded after the tempo fitter left the chain: onset was mean 145 / max 410 and is
    // now 15.6 / 54.6, duration 165 / 290 and now 13.7 / 54.6. Same story as the rubato-only
    // case above — most of what this row measured was a tempo curve absorbing a rubato warp —
    // except that here a tenth of it survives, because the truth's tempo moves *through* the
    // frame and `InsertRubato` fits one intensity for the whole of it.
    //
    // What the row never measured is issue #27, and cannot, by construction. Every performance
    // in this suite is rendered from its own truth MPM, so a note lands exactly where the tempo
    // predicts and no note sounds ahead of its predecessor. Both #26 and #27 need a recording
    // that disagrees with its notation, which is what an alignment is and what a render is not.
    // They are covered in tests/fitting/tempo instead.
    note: 'one rubato intensity is fitted across a frame the tempo moves through',
    bounds: {
      onset: { mean: 22, max: 80 },
      duration: { mean: 20, max: 80 },
      velocity: { max: 0.5 },
    },
  },
  {
    name: 'tempo + dynamics + accentuation',
    score: { beats: 9 },
    truth: {
      tempo: [
        { date: 0, bpm: 100, 'transition.to': 80, meanTempoAt: 0.5 },
        { date: END, bpm: 80 },
      ],
      dynamics: [
        { date: 0, volume: 55, 'transition.to': 95, curvature: 0, protraction: 0 },
        { date: END, volume: 95 },
      ],
      accentuation: {
        date: 0,
        name: 'metre',
        length: 4,
        scale: 1,
        loop: true,
        accentuations: [
          { beat: 1, value: 16 },
          { beat: 2, value: 2 },
          { beat: 3, value: 9 },
          { beat: 4, value: 0 },
        ],
      },
    },
    bounds: { onset: { max: 0.5 }, duration: { max: 0.5 }, velocity: { mean: 0.7, max: 1.6 } },
  },
  {
    name: 'all five aspects at once',
    score: { beats: 17 },
    truth: EVERYTHING,
    // Re-recorded, and the only row where taking the tempo fitter out made a figure *worse*.
    //
    // Onset went from mean 415 / max 750 to exactly zero — every onset is now reproduced to
    // the float — and velocity from 8 / 20 to 6.2 / 15.1. Duration went the other way: 405 /
    // 980 to 477 / 790. That is worth reading twice. With the timing exact, nothing is left in
    // the duration error that a tempo curve could have been blamed for: what is measured here
    // is the articulation fit alone, over notes whose sounding lengths a rubato has stretched,
    // and it is off by most of a note. The old number was smaller only because a wrong tempo
    // happened to shorten what a wrong articulation had lengthened.
    //
    // This is the tightest statement in the suite of where the remaining work is, and it did
    // not exist before the move: it took removing the fitter that dominated the residual to
    // see what was underneath it.
    note: 'articulation is fitted over durations the rubato has already stretched',
    bounds: {
      onset: { max: 0.5 },
      duration: { mean: 520, max: 900 },
      velocity: { mean: 8, max: 20 },
    },
  },
  // `all five aspects, boundaries withheld` used to sit here — the honest end-to-end number,
  // with the segmentation held back so the chain had to find its own. It needed two things this
  // application does not have: `ApproximateLogarithmicTempo` to fit one tempo window over the
  // whole piece and place its own turning points, and `StylizeArticulation` to cluster a single
  // averaged articulation call back apart. Neither has a successor here, so the mode went with
  // the case rather than being faked with the answer handed in.
];

export const allCases = [...tierTwoCases, ...tierThreeCases];
