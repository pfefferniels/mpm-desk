import type { Alignment, AlignedNote, AlignedPedal } from '../../alignment';
import { AbstractTransformer, idsOf, type ScopedTransformationOptions } from '../Transformer';
import { type Range, rangeOfNotes } from '../range';
import { expansion, type ExpansionPoint } from '../../expansion';
import { displace, restretch, restretchPress, type ModifySelector } from './Modify';

/**
 * What an expansion is about: one of `Modify`'s three selectors, or none of them.
 *
 * Without a selector the call is about every event of its scope. That is the usual case, because
 * an expansion is mostly a claim about the medium — the roll squeezed its whole range against a
 * floor — rather than about a place in the music.
 */
export type ExpandSelector =
  | ModifySelector
  | { noteIDs?: undefined; pedalIDs?: undefined; from?: undefined; to?: undefined };

export type ExpandOptions = ScopedTransformationOptions &
  ExpandSelector & {
    /** As `Modify`'s: velocity steps, or milliseconds of onset or of duration. */
    aspect: 'velocity' | 'onset' | 'duration';
    /**
     * Where the recorded values go, as pairs of recorded value and new value: at least two, the
     * recorded values rising. Between two points a value is mapped linearly, and beyond the
     * outermost the outermost line carries on, so the points need not span the recording.
     */
    points: ExpansionPoint[];
  };

/**
 * A correction to the recording that maps a whole range of values onto another, rather than
 * shifting each by the same amount.
 *
 * `Modify` says that at a place the pianist played softer, earlier or longer than the roll shows.
 * This says that the medium bent the scale itself: a Welte roll cannot sound softer than its
 * floor, so wherever the playing went below it the roll squeezes the soft end together, and only
 * stretching the range back open undoes that. The points state the stretch: `[[35, 20], [54, 46]]`
 * takes the roll's floor of 35 to 20 and its loudest note of 54 to 46, and everything between
 * along the line, so a note is moved further the softer it was recorded.
 *
 * The aspects are `Modify`'s, read the same way. For `velocity` the value is the velocity. For
 * `onset` it is the time of the attack, in milliseconds from the first note's — the zero every
 * desk shows, rather than the start of the roll, whose leader is no part of the performance —
 * and the event moves without changing its length, as under `Modify`; for `duration` it is the
 * length, and the release moves. A roll played at the wrong speed would want both, with the same
 * points.
 *
 * ## Which events
 *
 * With a selector, the events it names, read as `Modify` reads it — a pedal only by its id. Without
 * one, every note of the scope, and for the two timing aspects of a global call every pedal as
 * well: a stretch of the recording's time that left the pedalling where it was would take the
 * pedal off the notes it holds.
 *
 * ## Its place in the chain
 *
 * After `CorrectPedal`, so a stretch of time reaches a press the correction added; before
 * `Modify`, so a correction by hand is made on the scale the expansion has opened. Two
 * expansions of one aspect apply one after the other, in the order of the calls.
 *
 * Like `Modify` it writes no instruction.
 *
 * ## What follows it
 *
 * The guides of the dynamics curve are set on the expanded scale, so the editor moves them with
 * an expansion of velocity when one is added or taken away (`src/model/guides.ts`), and the
 * desks draw where an event was before it as a grey ghost, by running the map backwards
 * (`useCorrectionDeltas`).
 */
export class Expand extends AbstractTransformer<ExpandOptions> {
  readonly name = 'Expand';
  requires = [];

  constructor(options?: ExpandOptions) {
    super(
      options || {
        scope: 'global',
        aspect: 'velocity',
        points: [
          [0, 0],
          [127, 127],
        ],
      },
    );
  }

  /** Without a selector, or by pedal, an expansion is about no one place in the piece. */
  range(msm: Alignment): Range | undefined {
    const options = this.options;
    if ('from' in options && options.from !== undefined && options.to !== undefined)
      return { from: options.from, to: options.to };
    if ('noteIDs' in options && options.noteIDs) return rangeOfNotes(options.noteIDs, msm);
    return undefined;
  }

  /** What it maps, which is what the map was read off. */
  override evidence(msm: Alignment): string[] {
    const { notes, pedals } = this.events(msm);
    return idsOf([...notes, ...pedals]);
  }

  /** The notes and the pedals the call is about. */
  private events(msm: Alignment): { notes: AlignedNote[]; pedals: AlignedPedal[] } {
    const options = this.options;

    if ('noteIDs' in options && options.noteIDs) {
      // Every reading under the id, as `Modify` does, for the reason it gives.
      const ids = new Set(options.noteIDs);
      return { notes: msm.allNotes.filter((note) => ids.has(note['xml:id'])), pedals: [] };
    }
    if ('pedalIDs' in options && options.pedalIDs) {
      const ids = new Set(options.pedalIDs);
      return { notes: [], pedals: msm.pedals.filter((pedal) => ids.has(pedal['xml:id'])) };
    }
    if ('from' in options && options.from !== undefined && options.to !== undefined) {
      return { notes: msm.in(options.scope).notesInRange(options.from, options.to), pedals: [] };
    }
    return {
      notes: msm.in(options.scope).notes(),
      pedals: options.scope === 'global' ? msm.pedals : [],
    };
  }

  protected transform(msm: Alignment): void {
    const { aspect, points } = this.options;
    const map = expansion(points);
    if (!map) {
      console.error(
        `Expand: ${JSON.stringify(points)} draws no map — it needs two points or more, of finite ` +
          'numbers, with the recorded values rising',
      );
      return;
    }

    const { notes, pedals } = this.events(msm);

    switch (aspect) {
      case 'velocity':
        if ('pedalIDs' in this.options && this.options.pedalIDs) {
          // Reported, as `Modify` reports it: the call was built wrong.
          console.error('Expand: velocity is a property of a note, not of a pedal');
          return;
        }
        for (const note of notes) note.velocity = Math.max(0, map(note.velocity));
        return;

      case 'onset': {
        // The first note's onset among all of them, as `shiftToFirstOnset` will take it.
        const zero = msm.allNotes.reduce(
          (first, note) =>
            Number.isFinite(note['milliseconds.date']) ? Math.min(first, note['milliseconds.date']) : first,
          Infinity,
        );
        if (!Number.isFinite(zero)) return;
        for (const event of [...notes, ...pedals]) {
          const onset = event['milliseconds.date'];
          // A note the recording never played has no onset to map, as under `Modify`.
          if (!Number.isFinite(onset)) continue;
          displace(event, zero + map(onset - zero) - onset);
        }
        return;
      }

      case 'duration':
        for (const note of notes) {
          const length = note['milliseconds.date.end'] - note['milliseconds.date'];
          if (!Number.isFinite(length)) continue;
          restretch(note, map(length) - length);
        }
        for (const pedal of pedals) {
          const length = pedal['milliseconds.date.end'] - pedal['milliseconds.date'];
          if (!Number.isFinite(length)) continue;
          restretchPress(pedal, map(length) - length);
        }
        return;

      default:
        console.error(`Unknown aspect: ${String(aspect)}`);
    }
  }
}
