import { FrameDomain } from 'espressivo';
import {
  getInstructions,
  Mpm,
  ornamentDraftOf,
  scopesOf,
  setOrnamentDraft,
} from '../../instructions/index';
import { Alignment } from '../../alignment';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';
import { dateAtMilliseconds, millisecondsAt } from './tempoCalculations';
import { placeTempos, type PlacedTempo, segmentAtMs } from './placedTempos';

export interface TranslatePhysicalTimeToTicksOptions extends TransformationOptions {
  /**
   * Defines whether physical modifiers which are already present in the MPM
   * (e.g. because of a previous <ornamentation> or <asynchrony> interpolation)
   * should be translated into symbolic ones too.
   */
  translatePhysicalModifiers: boolean;

  /**
   * Defines whether the pedal instruction in the alignment should be
   * translated to tick time as well.
   * @todo not yet implemented
   */
  translatePedalling?: boolean;
}

/**
 * Converts the physical parts of the MPM into the tick domain.
 *
 * What it converts is an `<ornament>` frame written in milliseconds, which has to become ticks in
 * the document itself — an edit to the MPM rather than a note about the score.
 *
 * It writes no `tickDate` or `tickDuration` onto the notes: where a recorded onset falls on the
 * score grid is derived on demand by `deriveResidual`, so populating it here would serve nobody
 * and would make every later fit depend on this having run.
 *
 * The name is wider than the work and stays so: saved work files name it, and `requires`
 * relations across the chain point at it.
 *
 * **No desk offers this.** `buildChain` puts one in every chain; see the note on `INJECTED`
 * there. So `transform` has to be cheap on a document with no ornaments in it.
 */
export class TranslatePhysicalTimeToTicks extends AbstractTransformer<TranslatePhysicalTimeToTicksOptions> {
  name = 'TranslatePhysicalTimeToTicks';
  requires = [];

  constructor(options?: TranslatePhysicalTimeToTicksOptions) {
    super(
      options || {
        translatePhysicalModifiers: true,
      },
    );
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    if (this.options.translatePhysicalModifiers) this.translatePhysicalMPMModifiers(mpm, msm);
  }

  /**
   * Where a millisecond time falls on the tick grid.
   *
   * The tempo segments cover the piece, and the times asked about do not have to: an ornament's
   * frame reaches backwards from its anchor, so a roll on the first beat asks about a negative
   * time, and a roll near the last one can ask about a time past the final note. Both fall out
   * of the loop and answer `undefined`; a caller that subtracts that writes `NaN` into the
   * frame and marks the ornament converted. A roll that begins before its beat is what an
   * arpeggio *is*, so that is every piece-initial ornament.
   *
   * There is no extrapolation here for either end, and not because extrapolating is wrong: it
   * would be a third and fourth hand-copy of a rule `segmentAtMs` and `dateAtMilliseconds`
   * state once. A first-segment copy measures from `ms` where the cursor starts at `startMs`,
   * and a last-segment copy reads `@transition.to` straight off the record — which is not the
   * tempo the span arrives at when `@meanTempoAt` resolves the transition away. Both ends come
   * out of the same two functions the note walk uses, so an ornament and the notes it ornaments
   * cannot be placed by different arithmetic.
   */
  private msToTicks(ms: number, segments: PlacedTempo[]): number | undefined {
    const segment = segmentAtMs(segments, ms);
    if (!segment) return undefined;
    const ticks = dateAtMilliseconds(ms - segment.startMs, segment.resolved);
    // `dateAtMilliseconds` answers `NaN` for a time it was not given — the caller subtracts
    // this to build a frame, and a `NaN` frame is the shape issue #26 was reported as.
    return Number.isFinite(ticks) ? ticks : undefined;
  }

  private ticksToMs(ticks: number, segments: PlacedTempo[]) {
    for (const { tempo, resolved, startMs } of segments) {
      // The tick window is the instruction's own span, and for the last segment that ends
      // at the end of the score rather than running open — so this is deliberately not
      // `coversDate`, which lets the last segment take everything after the score ends.
      if (ticks >= tempo.date && ticks < tempo.endDate) {
        return startMs + millisecondsAt(ticks, resolved);
      }
    }
    return undefined;
  }

  /**
   * Walks through physical attributes in the
   * given MPM and translates them into tick values.
   * @todo Currently, only ornaments are taken into account.
   */
  translatePhysicalMPMModifiers(mpm: Mpm, msm: Alignment): void {
    for (const scope of scopesOf(mpm)) {
      // Which ornaments have something to translate is settled before the tempo map is built,
      // because the map is the expensive half — `placeTempos` walks the tempo list and looks up
      // the anchoring note at every boundary — and this transformer runs on every chain now,
      // including the many that hold no ornament at all. Reading the drafts costs one pass over
      // the scope's ornaments, and that pass is then the whole cost of a chain with nothing to do.
      // `flatMap` rather than a filter, so that the two guards below also narrow the frame away
      // from `number | undefined` — the arithmetic downstream is the reason they are here.
      const pending = getInstructions(mpm, 'ornament', scope).flatMap((ornament) => {
        // The frame is not an `<ornament>` attribute and never was — it belongs to the
        // `<temporalSpread>` of the def `StylizeOrnamentation` will build, and until then
        // it is parked on the element as a draft. So it is read and written there rather
        // than through the instruction, which espressivo's options type has no field for.
        const draft = ornamentDraftOf(ornament.element);

        // the job is done already
        if (draft.frameDomain === FrameDomain.Ticks) return [];

        // An ornament fitted by `InsertDynamicsGradient` carries a velocity ramp and no
        // frame at all. There is nothing physical on it to translate, and translating the
        // absence wrote a `NaN` frame plus a `time.unit` claiming it had been converted —
        // which is what turned every gradient-only ornament into one that
        // `StylizeOrnamentation` would go on to discard.
        if (draft.frameStart === undefined || draft.frameLength === undefined) return [];

        return [{ ornament, frameStart: draft.frameStart, frameLength: draft.frameLength }];
      });

      if (pending.length === 0) continue;

      const segments = placeTempos(msm, mpm, scope);

      for (const { ornament, frameStart, frameLength } of pending) {
        const ornamentMs = this.ticksToMs(ornament.date, segments);
        if (ornamentMs === undefined) continue;

        const frameStartMs = ornamentMs + frameStart;
        const frameEndMs = frameStartMs + frameLength;

        const frameStartTicks = this.msToTicks(frameStartMs, segments);
        const frameEndTicks = this.msToTicks(frameEndMs, segments);

        // Leave the ornament in milliseconds rather than stamp an unusable frame on it.
        // Milliseconds are a legal `time.unit`, so an untranslated ornament still
        // performs; a `NaN` one does not.
        if (frameStartTicks === undefined || frameEndTicks === undefined) continue;

        setOrnamentDraft(ornament.element, {
          frameStart: frameStartTicks - ornament.date,
          frameLength: frameEndTicks - frameStartTicks,
          frameDomain: FrameDomain.Ticks,
        });
      }
    }
  }
}
