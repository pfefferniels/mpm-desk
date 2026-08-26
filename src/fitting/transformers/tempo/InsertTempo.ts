import {
  getInstructions,
  type InstructionOptions,
  Mpm,
  removeInstruction,
  requireMap,
  type Scope,
} from '../../instructions/index';
import { Alignment } from '../../alignment';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { elementAt } from 'espressivo';

export interface InsertTempoOptions extends ScopedTransformationOptions {
  /** Where the tempo is stated, in ticks. */
  from: number;
  /** Where it stops applying, in ticks — exclusive. */
  to: number;
  bpm: number;
  /** The tempo at `to`, if this is a transition rather than a step. */
  transitionTo?: number;
  meanTempoAt?: number;
  beatLength: number;
}

/**
 * A tempo somebody states, rather than one the fitter solves for.
 *
 * `ApproximateLogarithmicTempo` reads a tempo off the onsets; this writes down the one it is
 * given. The range is exclusive at `to` and it owns that range outright: every `<tempo>` already
 * inside it is removed, and if nothing states a tempo at `to` itself, the one that was in force
 * there is written back — otherwise this instruction would go on sounding past the passage it
 * was meant for.
 *
 * It calls {@link Alignment.shiftToFirstOnset}, which rewrites `milliseconds.date` on every note
 * and pedal, so it has to run before `TranslatePhysicalTimeToTicks` reads the physical domain to
 * convert it. `Order.ts` places it there.
 */
export class InsertTempo extends AbstractTransformer<InsertTempoOptions> {
  readonly name = 'InsertTempo';
  readonly requires = [];
  /** The restored boundary tempo, which is this call's doing but not its subject. */
  private _boundaryId?: string;

  constructor(options?: InsertTempoOptions) {
    super(options || { scope: 'global', from: 0, to: 0, bpm: 120, beatLength: 0.25 });
  }

  protected override disowned(): readonly string[] {
    return this._boundaryId ? [this._boundaryId] : [];
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    this._boundaryId = undefined;
    msm.shiftToFirstOnset();
    const { from, to, bpm, transitionTo, meanTempoAt, beatLength } = this.options;
    const scope = this.options.scope;

    this.removeAffectedTempoInstructions(mpm, scope, from, to);

    const tempo: InstructionOptions<'tempo'> = {
      id: generateId('tempo', from, mpm),
      date: from,
      bpm,
      beatLength,
      ...(transitionTo !== undefined
        ? {
            transitionTo,
            meanTempoAt: meanTempoAt ?? 0.5,
          }
        : {}),
    };

    requireMap(mpm, 'tempo', scope).addTempo(tempo);
  }

  private removeAffectedTempoInstructions(mpm: Mpm, scope: Scope, from: number, to: number): void {
    const existing = getInstructions(mpm, 'tempo', scope)
      .slice()
      .sort((a, b) => a.date - b.date);
    if (existing.length === 0) return;

    const isCovered = (date: number) => date >= from && date < to;

    const boundary = to;
    if (!existing.some((t) => t.date === boundary)) {
      const effectiveIndex = findEffectiveTempoIndex(existing, boundary);
      if (effectiveIndex !== -1) {
        const effectiveTempo = elementAt(existing, effectiveIndex, 'the sorted tempo instructions');
        if (isCovered(effectiveTempo.date)) {
          const restore: InstructionOptions<'tempo'> = {
            id: generateId('tempo', boundary, mpm),
            date: boundary,
            beatLength: effectiveTempo.beatLength,
            bpm: effectiveTempo.bpm,
          };
          this._boundaryId = restore.id;
          for (const t of existing) {
            if (isCovered(t.date)) removeInstruction(mpm, t);
          }
          requireMap(mpm, 'tempo', scope).addTempo(restore);
          return;
        }
      }
    }

    for (const t of existing) {
      if (isCovered(t.date)) removeInstruction(mpm, t);
    }
  }
}

/** The last tempo at or before `date`, or -1 if the list starts after it. */
function findEffectiveTempoIndex(tempos: readonly { date: number }[], date: number): number {
  let result = -1;
  for (const [i, tempo] of tempos.entries()) {
    if (tempo.date <= date) result = i;
    else break;
  }
  return result;
}
