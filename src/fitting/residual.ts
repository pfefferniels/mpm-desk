/**
 * What the MPM as it stands does not yet explain.
 *
 * The fit is a reduction: each transformer accounts for one slice of the deviation between the
 * score and the recording, and the next one works on what is left. This module computes that
 * remainder from the score, the recording and the MPM, on demand, rather than *carrying* it —
 * writing it back onto the aligned notes as `tickDate`, `tickDuration` and
 * `absoluteVelocityChange`, each step subtracting its own share for the next.
 *
 * The difference is not tidiness. An accumulated remainder cannot be undone (undoing step 4
 * leaves steps 5 to 8's subtractions behind) and cannot be refitted (revise the tempo and every
 * later fit was made against a remainder that no longer exists, silently). A computed one is
 * free of both.
 *
 * ## `without`
 *
 * A transformer asks for the residual with its own dimension held out:
 *
 * ```ts
 * const residual = deriveResidual(msm, mpm, { without: ['articulation'] })
 * ```
 *
 * — "what does everything *else* explain?" That is the same quantity the subtraction would
 * produce, arrived at by construction rather than by bookkeeping.
 *
 * ## Two domains, two sources, deliberately
 *
 * The tick figures come from replaying the tempo walk in `tickTimes.ts`; the velocity comes from
 * rendering the MPM through espressivo. That split is not an accident of implementation:
 *
 * - **Ticks cannot come from a render.** The walk re-anchors on the recorded onset at every
 *   tempo boundary, so it is a function of the MPM *and* the recording. A rendered performance
 *   has no recording to anchor to, and inverting one gives a different table — the failure mode
 *   being that every rubato silently moves. See the note at the top of `tickTimes.ts`.
 * - **Velocity should not come from anywhere else.** It is the dynamics curve times the
 *   accentuation pattern times articulation's `relativeVelocity`. espressivo composes all three
 *   and is held byte-equivalent to meico on it; reassembling that here would be new and
 *   unproven code that has to stay in step with a renderer it does not own.
 */
import {
  exportMPM,
  getInstructions,
  type InstructionType,
  type Scope,
  Mpm,
  scopesOf,
  withoutMaps,
} from './instructions/index';
import { Alignment, type AlignedNote, type AlignedPedal } from './alignment';
import { computeTickTimes } from './transformers/tempo/tickTimes';
import { performMsmToData } from 'espressivo';

export interface NoteResidual {
  readonly note: AlignedNote;

  /**
   * Where the recorded onset falls on the score grid, in ticks. `undefined` when no `<tempo>`
   * covers the note, which is what the MPM having no tempoMap yet looks like.
   */
  readonly tickDate: number | undefined;

  /** The recorded duration on the score grid, in ticks. */
  readonly tickDuration: number | undefined;

  /**
   * Recorded velocity minus rendered, in MIDI units. The quantity the accumulator spelled
   * `absoluteVelocityChange`.
   */
  readonly velocity: number | undefined;

  /**
   * What the probed MPM sounds this note at. The quantity `InsertArticulation` reaches by
   * taking the residual back off the recording, and the divisor `relativeVelocity` needs:
   * the renderer computes velocity as dynamics x relativeVelocity, so the ratio to write is
   * `note.velocity / renderedVelocity`.
   */
  readonly renderedVelocity: number | undefined;
}

export interface PedalResidual {
  readonly pedal: AlignedPedal;
  readonly tickDate: number | undefined;
  readonly tickDuration: number | undefined;
}

export interface Residual {
  of(note: AlignedNote): NoteResidual | undefined;
  ofPedal(pedal: AlignedPedal): PedalResidual | undefined;
  readonly notes: readonly NoteResidual[];
  readonly pedals: readonly PedalResidual[];
}

export interface DeriveResidualOptions {
  /**
   * Instruction types to take out of the MPM before measuring — normally the one dimension
   * the caller is about to fit, so that what comes back is what it has to account for.
   */
  readonly without?: readonly InstructionType[];
}

/**
 * espressivo needs a seed for any imprecision distribution that carries none of its own. A fixed
 * one keeps the residual from moving between two calls that were asked the same question.
 */
const RESIDUAL_SEED = 0x6d706d;

/**
 * The last residual derived, and the probe it was derived from.
 *
 * A run of the real reconstruction asks for a residual **232 times** — once per `InsertRubato`,
 * `InsertArticulation`, `InsertMetricalAccentuation` and `InsertPedal` call — and each ask
 * renders the whole document. That is where eleven of the twelve seconds go.
 *
 * Almost all of those asks are the same question. The chain runs in reduction order, so calls of
 * one kind run consecutively, and a call asks for the residual with *its own dimension held out*
 * — so a `<rubato>` written by the previous `InsertRubato` is removed again by `withoutMaps`
 * before the probe is built. Fifty-six consecutive rubato fits therefore see one document.
 *
 * The key is the probe's own serialization, which is not a heuristic: two probes that serialize
 * identically ARE the same document as far as everything downstream is concerned — the tempo
 * walk reads it, and the render is `performMsmToData` on exactly this text. It also costs
 * nothing extra, because `renderedVelocities` has to serialize the probe anyway.
 *
 * One entry, not a table. The pattern being exploited is consecutiveness, so a second entry
 * would only hold a document the chain has already moved past.
 */
/**
 * What the last run spent deriving residuals, and how much of it the caches saved.
 *
 * Kept in the shipped code rather than behind a flag because "why is this refit slow" is a
 * question the editor has to be able to answer about a document it did not choose. The counters
 * are six integers; reset them with {@link clearResidualCache}.
 */
export const residualStats = {
  /** Calls to {@link deriveResidual}. */
  asks: 0,
  /** Answered from the probe cache without deriving anything. */
  hits: 0,
  /** Answered the tick half from cache while still rendering the velocity half. */
  tickHits: 0,
  withoutMs: 0,
  exportMs: 0,
  ticksMs: 0,
  renderMs: 0,
};

/**
 * What the tick walk actually depends on: the tempo and rubato instructions, and nothing else.
 *
 * `computeTickTimes` reads `placeTempos` — the tempo map — and then takes the rubato distortion
 * back out. That is the whole of its input besides the alignment. So a second cache, keyed on
 * just those two maps, catches the case the probe-level one cannot: an `InsertMetricalAccentuation`
 * or `InsertArticulation` call writes a `<…Def>` into the *header*, which `withoutMaps` does not
 * remove, so the probe text differs on every call of those two kinds — 76 of the run's 78 misses —
 * while the tick domain has not moved at all.
 *
 * The element is dropped from each record because it is a live node; what is left is the numbers
 * the walk reads, which is exactly the right granularity for a key.
 */
const tickKeyOf = (mpm: Mpm): string => {
  // The element is a live node and cannot be stringified; what is left is the numbers the walk
  // reads, which is the right granularity for a key.
  const stated = <K extends 'tempo' | 'rubato'>(type: K, scope: Scope) =>
    getInstructions(mpm, type, scope).map((instruction) => {
      const { element, ...rest } = instruction;
      void element;
      return rest;
    });

  return JSON.stringify(scopesOf(mpm).map((scope) => [stated('tempo', scope), stated('rubato', scope)]));
};

let lastTicks: { key: string; msm: Alignment; ticks: ReturnType<typeof computeTickTimes> } | null =
  null;

let lastProbe: { xml: string; msm: Alignment; residual: Residual } | null = null;

/**
 * Forget everything cached, and zero the counters.
 *
 * The reduction is a fold over module state, so a test that runs two chains in one process must
 * clear between them — otherwise the second run can answer from the first's document where the
 * two happen to serialize alike, which is a passing test that proves nothing.
 */
export const clearResidualCache = (): void => {
  lastProbe = null;
  lastTicks = null;
  for (const key of Object.keys(residualStats) as (keyof typeof residualStats)[]) {
    residualStats[key] = 0;
  }
};

export const deriveResidual = (
  msm: Alignment,
  mpm: Mpm,
  options: DeriveResidualOptions = {},
): Residual => {
  const _t0 = Date.now();
  const probe = options.without?.length ? withoutMaps(mpm, options.without) : mpm;
  residualStats.withoutMs += Date.now() - _t0;
  residualStats.asks++;

  // Identity on the alignment, not equality: `MakeChoice` and `Modify` write through it, so a
  // different alignment object is a different question even where the MPM is byte-identical.
  const _t1 = Date.now();
  const probeXml = exportMPM(probe);
  residualStats.exportMs += Date.now() - _t1;
  if (lastProbe && lastProbe.msm === msm && lastProbe.xml === probeXml) { residualStats.hits++; return lastProbe.residual; }

  const _t2 = Date.now();
  const tickKey = tickKeyOf(probe);
  let ticks;
  if (lastTicks && lastTicks.msm === msm && lastTicks.key === tickKey) {
    ticks = lastTicks.ticks;
    residualStats.tickHits++;
  } else {
    ticks = computeTickTimes(msm, probe);
    lastTicks = { key: tickKey, msm, ticks };
  }
  residualStats.ticksMs += Date.now() - _t2;
  const _t3 = Date.now();
  const rendered = renderedVelocities(msm, probeXml);
  residualStats.renderMs += Date.now() - _t3;

  const notes: NoteResidual[] = msm.allNotes.map((note) => {
    const placed = ticks.notes.get(note['xml:id']);
    const renderedVelocity = rendered?.get(note['xml:id']);
    return {
      note,
      tickDate: placed?.tickDate,
      tickDuration: placed?.tickDuration,
      velocity: renderedVelocity === undefined ? undefined : note.velocity - renderedVelocity,
      renderedVelocity,
    };
  });

  const pedals: PedalResidual[] = msm.pedals.map((pedal) => {
    const placed = ticks.pedals.get(pedal['xml:id']);
    return { pedal, tickDate: placed?.tickDate, tickDuration: placed?.tickDuration };
  });

  const byNote = new Map(notes.map((entry) => [entry.note['xml:id'], entry]));
  const byPedal = new Map(pedals.map((entry) => [entry.pedal['xml:id'], entry]));

  const residual: Residual = {
    of: (note) => byNote.get(note['xml:id']),
    ofPedal: (pedal) => byPedal.get(pedal['xml:id']),
    notes,
    pedals,
  };

  lastProbe = { xml: probeXml, msm, residual };
  return residual;
};

/** What the probed MPM renders each note at, by `xml:id`. */
const renderedVelocities = (
  msm: Alignment,
  mpmXml: string,
): Map<string, number> | undefined => {
  const score = msm.serializeScore();
  if (!score) return undefined;

  const data = performMsmToData(
    { msm: score, mpm: mpmXml },
    // No ornament expansion: a v3 ornament generates notes the score never had, and a
    // generated note has no recorded counterpart to be a residual against. Held out, every
    // performed note answers to an `xml:id` the score also knows.
    { expandOrnaments: false, seed: RESIDUAL_SEED },
  );

  const velocities = new Map<string, number>();
  for (const part of data.parts) {
    for (const note of part.notes) {
      if (note.id !== null) velocities.set(note.id, note.velocity);
    }
  }
  return velocities;
};
