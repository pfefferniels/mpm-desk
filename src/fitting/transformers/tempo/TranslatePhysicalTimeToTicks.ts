import { type Element, FrameDomain } from 'espressivo';
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
import {
  dateAtRenderedMs,
  placeTempos,
  type PlacedTempo,
  renderedMsAt,
  segmentTiming,
} from './placedTempos';

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

/** A frame in ticks, from the ornament's date. */
interface TickFrame {
  start: number;
  length: number;
}

/**
 * Whether the renderer plays this ornament by writing notes of its own, rather than by moving
 * the ones the score has at its date.
 *
 * espressivo's own gate (`generatesNotes` in its `ornamentInstantiation.ts`, which it does not
 * export), read off the same three marks: a pool of `<note>` children, a `@repetitions`, or the
 * grouping syntax in `@note.order`. A grace figure with a pool is one; an arpeggio is not, and
 * neither is the figure of a single grace note tied into its principal, which has no pool and
 * moves the principal alone.
 */
const generatesNotes = (element: Element): boolean =>
  element
    .getChildElements()
    .toArray()
    .some((child) => child.getLocalName() === 'note') ||
  element.getAttributeValue('repetitions') !== null ||
  /[[\]|]/.test(element.getAttributeValue('note.order') ?? '');

/**
 * The frame of an ornament over notes the score already has, which is what an arpeggio is.
 *
 * The renderer moves each note by its share of the frame and leaves it where it is in the score,
 * so every note of the chord is timed by the one `<tempo>` that times the chord's date
 * ({@link segmentTiming}: on a boundary, the earlier one), continued past either end of its span
 * where the frame reaches that far. The whole frame is therefore measured under that one
 * instruction, and it is exact wherever the renderer evaluates the instruction as
 * `millisecondsAt` does: inside its span, and past either end of a constant one. Measured under
 * the instruction that *starts* on the date instead, the roll on tick 5760 of WM 225, 107 ms
 * wide and all of it after the beat, played 153 ms wide.
 *
 * Two places are left where the two are not the same arithmetic:
 *
 * - **Past the end of a transition**, which is the after-beat half of a roll on a boundary. The
 *   renderer lets the curve run on and `millisecondsAt` holds the tempo it arrived at. Over the
 *   length of a roll that is a fraction of a bpm.
 * - **Before the start of a transition** the chord lies inside. The renderer has no answer
 *   there: `tempoAt` takes a power of a negative number, which is `NaN` for every exponent but
 *   a whole one, and the note is sounded at `NaN`. No tick frame can be played, so such a frame
 *   is left in milliseconds, which the renderer adds after the tempo map has run.
 */
const chordFrame = (
  segments: PlacedTempo[],
  date: number,
  frameStart: number,
  frameLength: number,
): TickFrame | undefined => {
  const segment = segmentTiming(segments, date);
  if (!segment) return undefined;

  const at = millisecondsAt(date, segment.resolved);
  const start = dateAtMilliseconds(at + frameStart, segment.resolved);
  const end = dateAtMilliseconds(at + frameStart + frameLength, segment.resolved);
  // `dateAtMilliseconds` answers `NaN` for a time it was not given, and a `NaN` frame is the
  // shape issue #26 was reported as.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;

  if (
    segment.resolved.kind !== 'constant' &&
    date > segment.tempo.date &&
    start < segment.tempo.date
  ) {
    return undefined;
  }

  return { start: start - date, length: end - start };
};

/**
 * The frame of an ornament that writes its own notes, which is what a grace figure is.
 *
 * The renderer lays those notes out on the tick grid and each is then a note of the score where
 * it lies, timed by the `<tempo>` that has that tick. A figure reaching back across a boundary
 * is under the earlier instruction on the far side of it and the later one on the near side, so
 * the frame is measured along the tempo map as a whole ({@link renderedMsAt},
 * {@link dateAtRenderedMs}).
 */
const figureFrame = (
  segments: PlacedTempo[],
  date: number,
  frameStart: number,
  frameLength: number,
): TickFrame | undefined => {
  const at = renderedMsAt(segments, date);
  if (at === undefined) return undefined;

  const start = dateAtRenderedMs(segments, at + frameStart);
  const end = dateAtRenderedMs(segments, at + frameStart + frameLength);
  if (start === undefined || end === undefined) return undefined;

  return { start: start - date, length: end - start };
};

/**
 * Converts the physical parts of the MPM into the tick domain.
 *
 * What it converts is an `<ornament>` frame written in milliseconds, which has to become ticks in
 * the document itself — an edit to the MPM rather than a note about the score.
 *
 * ## A frame is a distance, and the renderer is what measures it
 *
 * A fitter measures a frame off the recording as so many milliseconds before and after the
 * ornament's date. Written in ticks, it is played back by a renderer that moves each note by
 * those ticks and then times it with the tempo map alone. So the ticks that mean "632 ms before
 * the date" are the ones the *tempo map* puts 632 ms before it, and the recording has no further
 * say: the conversion runs on the map's own timeline (`PlacedTempo.renderedStartMs`), not on the
 * one `placeTempos` anchors on the recording at every boundary.
 *
 * It used to run on the anchored one, and the two part wherever a tempo does not land on the
 * note that ends it. A frame was measured back from the *recorded* boundary into a curve whose
 * own end is somewhere else, and came out wrong by the whole of that difference: on WM 225 the
 * grace note before bar 18's `ritard.` leads by 632 ms on the roll and played 838 ms ahead.
 *
 * Which tempo times a moved note depends on how the renderer plays the ornament, so there are
 * two conversions ({@link chordFrame}, {@link figureFrame}) and {@link generatesNotes} chooses.
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
  readonly name = 'TranslatePhysicalTimeToTicks';
  requires = [];

  constructor(options?: TranslatePhysicalTimeToTicksOptions) {
    super(
      options || {
        translatePhysicalModifiers: true,
      },
    );
  }

  range(): undefined {
    return undefined;
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    if (this.options.translatePhysicalModifiers) this.translatePhysicalMPMModifiers(mpm, msm);
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
        // absence wrote a `NaN` frame plus a unit claiming it had been converted —
        // which is what turned every gradient-only ornament into one that
        // `StylizeOrnamentation` would go on to discard.
        if (draft.frameStart === undefined || draft.frameLength === undefined) return [];

        return [{ ornament, frameStart: draft.frameStart, frameLength: draft.frameLength }];
      });

      if (pending.length === 0) continue;

      const segments = placeTempos(msm, mpm, scope);
      const begins = segments[0]?.tempo.date;

      for (const { ornament, frameStart, frameLength } of pending) {
        // Before the tempo map begins there is no `<tempo>` to measure under: the renderer times
        // those notes at MPM's default, which is no tempo of this document. The frame stays as
        // it was measured, in milliseconds, and plays as that.
        if (begins === undefined || ornament.date < begins) continue;

        const frame = (generatesNotes(ornament.element) ? figureFrame : chordFrame)(
          segments,
          ornament.date,
          frameStart,
          frameLength,
        );

        // Leave the ornament in milliseconds rather than stamp an unusable frame on it.
        // A millisecond frame is legal MPM, so an untranslated ornament still performs;
        // a `NaN` one does not.
        if (frame === undefined) continue;

        setOrnamentDraft(ornament.element, {
          frameStart: frame.start,
          frameLength: frame.length,
          frameDomain: FrameDomain.Ticks,
        });
      }
    }
  }
}
