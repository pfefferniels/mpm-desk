/**
 * The rubato warp, and how to take it back off a recorded position.
 *
 * `<rubato>` moves notes within a frame without moving the frame, so it is a warp of the tick
 * grid — the domain `tickDate` and `tickDuration` live in. Once the MPM says a rubato is there,
 * the part of a note's deviation that rubato accounts for is no longer anyone else's to explain,
 * and `removeRubatoDistortion` is what takes it off.
 *
 * It lives apart from `InsertRubato` because the transformer does not perform the warp: the score
 * is left as it was found, and the warp comes off the derived positions instead.
 *
 * The frame lookups address the score grid, so the positions handed to them are symbolic. An
 * offset of `note.date + note.tickDuration` mixes a symbolic position with a performed one
 * (issue #40).
 */
import type { AddRubatoOptions } from 'espressivo';
import {
  resolveRubato,
  type Rubato as ResolvedRubato,
} from 'espressivo';
import { instructionsEffectiveAtDate, Mpm, type Scope } from '../../instructions/index';
import { Alignment } from '../../alignment';
import type { TickTimes } from '../tempo/tickTimes';

/**
 * What this module needs a `<rubato>` to say: where its first frame begins, and the five
 * parameters the warp is built from.
 *
 * Narrower than the whole of `AddRubatoOptions` on purpose — `@name.ref` and `@xml:id` say
 * nothing about where a date lands, and naming only the fields that do lets a caller hand in
 * anything shaped like a frame, which is what the tests do.
 */
export type RubatoFrame = Pick<
  AddRubatoOptions,
  'date' | 'frameLength' | 'intensity' | 'lateStart' | 'earlyEnd' | 'loop'
>;

/**
 * `@frameLength` as the arithmetic below needs it.
 *
 * It is optional on the instruction because a `<rubato>` may inherit it from the `rubatoDef` it
 * names; no def is modelled here and every parameter is written onto the element, so the only way
 * to reach here without one is a document that says nothing. Such a case is *typed* as a number
 * and reads back `undefined`, and every figure derived from it comes out NaN. The assertion keeps
 * exactly that rather than inventing a frame — {@link resolve} is where absence is actually
 * answered, and it answers with the identity.
 */
const frameLengthOf = (rubato: RubatoFrame) => rubato.frameLength as number;

/**
 * One `<rubato>` record with its parameters defaulted and clamped the way the renderer does it.
 *
 * The defaulting and the clamping are the renderer's, not written out here. Written out, they
 * drift from meico in two ways that a perfectly ordinary document reaches:
 *
 * - capping `lateStart` at **0.9** and flooring `earlyEnd` at **0.1**. Neither bound exists in
 *   meico, which only floors `lateStart` at 0 and caps `earlyEnd` at 1 — so a `lateStart="0.95"`
 *   is fitted against 0.9 while rendering at 0.95.
 * - leaving an inverted or empty window (`lateStart >= earlyEnd`) inverted, producing a
 *   *reversed* warp, where meico widens it to the whole frame and produces the identity.
 *
 * Measured on a 720-tick frame read at its midpoint, four of seven test windows disagreed, by up
 * to 72 ticks. `resolveRubato` is the renderer's own resolution and settles all of it, in
 * RubatoMap.java's order, including the `@intensity` default of 1.0.
 *
 * `null` where there is no frame to warp — an absent `@frameLength`, which is the one parameter
 * with no default. Without the early return the span arithmetic divides by `undefined` and hands
 * back `NaN`; the return says so before the span is computed. `resolveRubato` would reject the
 * instruction on the same grounds a line later, so this is the type agreeing with the answer
 * rather than a new one.
 *
 * The `def` argument is `null` because no `<rubatoDef>` is modelled here: every parameter is
 * written onto the instruction. This is the seam where def inheritance would arrive, and passing
 * the argument explicitly is what keeps that a one-line change.
 */
const resolve = (rubato: RubatoFrame): ResolvedRubato | null => {
  if (rubato.frameLength === undefined) return null;

  return resolveRubato(
    { startDate: rubato.date, endDate: rubato.date + rubato.frameLength },
    {
      frameLength: rubato.frameLength,
      intensity: rubato.intensity,
      lateStart: rubato.lateStart,
      earlyEnd: rubato.earlyEnd,
      loop: rubato.loop,
    },
    null,
  );
};

/**
 * Where a symbolic date lands once the rubato has warped its frame.
 *
 * The three lines of arithmetic are meico's `RubatoMap.computeRubatoTransformation`, which
 * espressivo keeps private — it is the one `…At()` evaluator the package does not export, where
 * tempo, dynamics and movement all do. Everything that decides *what numbers go into* it comes
 * from {@link resolve}, so what is duplicated here is a formula with no defaults and no
 * branches, rather than the policy that is what actually drifts. If espressivo ever exports a
 * `rubatoAt`, this becomes a one-line delegation.
 *
 * An unresolvable rubato leaves the date where it was, which is what an identity warp means.
 */
export const calculateRubatoOnDate = (date: number, rubato: RubatoFrame): number => {
  const rd = resolve(rubato);
  if (rd === null) return date;

  // compute the position of the map element within the rubato frame
  const localDate = (date - rd.startDate) % rd.frameLength;
  const d =
    (Math.pow(localDate / rd.frameLength, rd.intensity) * (rd.earlyEnd - rd.lateStart) +
      rd.lateStart) *
    rd.frameLength;
  return date + d - localDate;
};

/**
 * This function does the opposite of `calculateRubatoDate`:
 * It removes the "rubato effect" from a given date.
 * TODO: find a numerical, non-iterative solution.
 */
const removeRubatoFromDate = (newDate: number, rubato: RubatoFrame) => {
  const frameLength = frameLengthOf(rubato);
  const target = rubato.date + ((newDate - rubato.date) % frameLength);
  let lowerBound = rubato.date;
  let upperBound = rubato.date + frameLength;

  while (upperBound - lowerBound > 1e-6) {
    const middle = (upperBound + lowerBound) / 2;
    const middleNewDate = calculateRubatoOnDate(middle, rubato);

    if (Math.abs(target - middleNewDate) < 1) {
      return middle - rubato.date;
    } else if (middleNewDate < target) {
      lowerBound = middle;
    } else {
      upperBound = middle;
    }
  }

  return lowerBound - rubato.date;
};

/**
 * Takes the rubato warp back off the derived tick date and duration of every note it covers.
 *
 * Every rubato the document holds is by definition already explained, so there is nothing to
 * filter: no transformer compensates the score itself, and the frames to take back off are
 * simply all of them.
 *
 * @todo remove the distortion from pedals as well.
 */
export const removeRubatoDistortion = (
  msm: Alignment,
  mpm: Mpm,
  scope: Scope,
  times: TickTimes,
): void => {
  const affectedNotes =
    scope === 'global' ? msm.allNotes : msm.allNotes.filter((n) => n.part - 1 === scope);

  for (const note of affectedNotes) {
    const time = times.notes.get(note['xml:id']);
    if (!time?.tickDuration) continue;

    const onsetRubato = instructionsEffectiveAtDate(mpm, note.date, 'rubato', scope)[0];
    if (!onsetRubato) continue;

    const onsetInTicks = calculateRubatoOnDate(note.date, onsetRubato);

    const onsetDiff = onsetInTicks - note.date;
    if (time.tickDate) {
      time.tickDate -= onsetDiff;
    }
    time.tickDuration -= onsetDiff;

    // Where the note ends, on the score grid. Both terms are symbolic, which is the domain
    // the rubato frames below are addressed in. Reading `note.date + note.tickDuration`
    // instead adds a symbolic position to a performed one, so the position handed to the
    // frame lookup is neither. See issue #40.
    const offset = note.date + note.duration;

    const rubatos = instructionsEffectiveAtDate(mpm, offset, 'rubato', scope);
    const effectiveRubato = rubatos[0];
    if (!effectiveRubato) continue;

    const rubatoStart = offset - ((offset - effectiveRubato.date) % frameLengthOf(effectiveRubato));
    const remainder = offset - rubatoStart;
    time.tickDuration -= remainder;

    const remainderWithoutRubato = removeRubatoFromDate(
      effectiveRubato.date + remainder,
      effectiveRubato,
    );
    time.tickDuration += remainderWithoutRubato;
  }
};
