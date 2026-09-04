import {
  getInstructions,
  type Instruction,
  Mpm,
  removeInstruction,
  requireMap,
} from '../../instructions/index';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { InsertRubato } from './InsertRubato';
import { Alignment } from '../../alignment';

export interface CombineAdjacentRubatoOptions extends ScopedTransformationOptions {
  /** How far two adjacent rubatos' `@intensity` may differ and still merge. */
  intensityTolerance: number;

  /** How far their `@lateStart` and `@earlyEnd` may differ and still merge. */
  compressionTolerance: number;
}

/**
 * Merges adjacent rubato instructions if they have the similiar intensity
 * and compression by adding the @loop parameter to the first rubato instruction
 * of a series and setting @intensity, @lateStart and @earlyEnd to the average
 * of the series.
 */
export class CombineAdjacentRubatos extends AbstractTransformer<CombineAdjacentRubatoOptions> {
  name = 'CombineAdjacentRubatos';
  requires = [InsertRubato];

  constructor(options?: CombineAdjacentRubatoOptions) {
    super(
      options || {
        intensityTolerance: 0.2,
        compressionTolerance: 0.1,
        scope: 'global',
      },
    );
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    const rubatos = getInstructions(mpm, 'rubato', this.options.scope);
    if (rubatos.length <= 1) return;

    // The map every write below goes through. It exists — `getInstructions` just read
    // instructions out of it.
    const map = requireMap(mpm, 'rubato', this.options.scope);

    const lastDate = msm.lastDate();

    // The frame the walk is about to fold a run onto: `undefined` once it has run past the
    // last rubato, which is the loop's own exit. The body works on `ref` rather than on
    // `next` itself, because the assignment at the foot of the loop otherwise makes the type
    // of `date` below depend, through the walk, on its own initializer.
    let next: Instruction<'rubato'> | undefined = rubatos[0];
    while (next) {
      // Reassigned rather than fixed, because folding a frame into `ref` writes through
      // the map and leaves this snapshot stale.
      let ref: Instruction<'rubato'> = next;

      // The frame the walk steps by. `@frameLength` is optional on the instruction — a
      // `<rubato>` may inherit it from a `rubatoDef` — and nothing here resolves an absent
      // one, so the arithmetic below stays NaN, `date < lastDate` is false, and a frame
      // that says nothing merges with nothing. The cast admits as much: the attribute may
      // be missing, and NaN is the behaviour that follows.
      const frameLength = ref.frameLength as number;

      // Where the run of frames after `ref` stopped. `undefined` means it ran off the
      // end of the piece, which is the case that has no successor and no loop to close:
      // advancing the walk unconditionally is what keeps the outer loop finite. Leaving
      // it to the `for` alone would let a `ref` whose next frame starts at or after the
      // last note never advance the walk, and spin forever.
      let stoppedAt: number | undefined = undefined;

      for (let date = ref.date + frameLength; date < lastDate; date += frameLength) {
        const current = rubatos.find((r) => r.date === date);

        // A frame that carries no @intensity is warped at 1.0, the renderer's default
        // (espressivo `resolveRubato`) — the identity, which is neither the rush nor the
        // delay the direction test below looks for, so such a frame merges with nothing.
        // Reading the attribute raw reached the same outcome by accident: every
        // comparison against `undefined` is false. The other two defaults, already
        // spelled out below, are 0.0 for @lateStart and 1.0 for @earlyEnd.
        const refIntensity = ref.intensity ?? 1;
        const currentIntensity = current?.intensity ?? 1;

        if (
          current &&
          ((refIntensity < 1 && currentIntensity < 1) ||
            (refIntensity > 1 && currentIntensity > 1)) &&
          Math.abs(currentIntensity - refIntensity) < this.options.intensityTolerance &&
          Math.abs((current.lateStart || 0) - (ref.lateStart || 0)) <
            this.options.compressionTolerance &&
          Math.abs((current.earlyEnd || 1) - (ref.earlyEnd || 1)) <
            this.options.compressionTolerance
        ) {
          const count = (date - ref.date) / frameLength;

          // Found again on every pass rather than carried across them: the removal
          // below shifts every entry after `current`, so an index cached from one
          // iteration names a different element in the next. The element itself is the
          // identity that survives.
          const index = map.getElementIndexOf(ref.element);
          map.updateRubatoAt(index, {
            loop: true,
            intensity: (refIntensity * count + currentIntensity) / (count + 1),
            lateStart: ((ref.lateStart || 0) * count + (current.lateStart || 0)) / (count + 1),
            earlyEnd: ((ref.earlyEnd || 1) * count + (current.earlyEnd || 1)) / (count + 1),
          });

          // Re-read rather than patched onto the snapshot in hand: the next pass folds
          // the following frame into these averages, and the numbers it has to average
          // are the ones the document now holds.
          const folded = map.getRubatoOptionsOf(index);
          if (folded) ref = { ...folded, type: 'rubato', element: ref.element, scope: ref.scope };

          removeInstruction(mpm, current);
          rubatos.splice(rubatos.indexOf(current), 1);
        } else {
          stoppedAt = date;
          break;
        }
      }

      if (stoppedAt === undefined) {
        // The run reached the end of the piece: nothing left to close the loop against.
        break;
      }

      // In order to stop the loop we need an instruction at the date it stopped — but only
      // where there is not one already. The walk stops for two reasons, and one of them is
      // that it found a frame it could not merge: that frame *is* what stops the loop, and
      // a neutral rubato beside it would be a second `<rubato>` at one date.
      //
      // espressivo's `addRubato` appends: it does not merge into an instruction already
      // standing at the same `@date`, so the check has to be made here rather than left to
      // the writer.
      //
      // Asked of the MAP and not of `rubatos`: that array is the snapshot this pass
      // started from, and a closer written by an earlier pass of the outer loop is in the
      // document without being in it. Checking the stale copy wrote a second `<rubato>` at
      // one date.
      const alreadyStopped = map
        .getAllElements()
        .some(({ key, value }) => key === stoppedAt && value.getLocalName() === 'rubato');

      if (ref.loop && !alreadyStopped) {
        map.addRubato({
          date: stoppedAt,
          frameLength,
          id: generateId('rubato', stoppedAt, mpm),
        });
      }

      next = rubatos.find((r) => r.date > stoppedAt);
    }
  }
}
