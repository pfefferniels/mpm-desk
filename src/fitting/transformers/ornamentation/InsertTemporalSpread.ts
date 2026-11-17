import type { AddOrnamentOptions } from 'espressivo';
import { FrameDomain, NoteOffShift } from 'espressivo';
import {
  Mpm,
  type OrnamentDraft,
  fillInAt,
  requireMap,
  setOrnamentDraft,
} from '../../instructions/index';
import { Alignment } from '../../alignment';
import type { Residual } from '../../residual';
import { isDefined } from '../../utils';
import { elementAt, pairwise } from 'espressivo';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { noteOrderOf } from './noteOrder';
import { type Range, rangeAt } from '../range';
import { determineIntensity } from './intensity';
import { graceEvidence, spreadGraces } from './graceSpread';

// Re-exported: the spacing fit is part of this module's public surface, and the rubato fit
// imports it from here.
export { determineIntensity } from './intensity';

export type ArpeggioPlacement = 'on-beat' | 'before-beat' | 'estimate' | 'none';
export type DatedArpeggioPlacement = Map<number, ArpeggioPlacement>;

/**
 * The roll of a chord: of the one on a date, or of every chord of the scope rolled wider than a
 * threshold, in ms.
 */
type ChordSpreadOptions = {
  placement: ArpeggioPlacement;
  noteOffShiftTolerance: number;
} & ({ date: number } | { durationThreshold: number });

/**
 * The lead of a grace figure: of one group, by the `xml:id` of its `graceGrp` (or grace chord),
 * or of every group the recording timed in the scope.
 *
 * Nothing else to say, where a roll has a placement to choose: a figure ends on the strike of the
 * note it leads into, and is written as it was played.
 */
type GraceSpreadOptions = { group: string } | { graces: 'all' };

export type InsertTemporalSpreadOptions = ScopedTransformationOptions &
  (ChordSpreadOptions | GraceSpreadOptions);

/**
 * Whether these options spread grace figures and not the rolls of chords.
 *
 * Asked by the desk as well, which lists the calls of either kind apart.
 */
export const spreadsGraces = (
  options: InsertTemporalSpreadOptions,
): options is ScopedTransformationOptions & GraceSpreadOptions =>
  'group' in options || 'graces' in options;

/**
 * Fits how an ornament's notes are spread in time, off the recorded onsets: the frame they fall
 * in, measured from the beat, and the spacing within it. Written as a physical value into the
 * MPM, which `TranslatePhysicalTimeToTicks` later puts into ticks.
 *
 * Two kinds of ornament, told apart by the options ({@link spreadsGraces}):
 *
 * - **The roll of a chord.** Interpolates the arpeggiated chord and subtracts accordingly from
 *   the recorded onsets, so that after the transformation all notes of the chord have the same
 *   onset.
 * - **The lead of a grace figure** (`graceSpread.ts`). Its notes have no time in the score, so
 *   the ornament brings them and names the note they lead into, and nothing is subtracted.
 */
export class InsertTemporalSpread extends AbstractTransformer<InsertTemporalSpreadOptions> {
  readonly name = 'InsertTemporalSpread';
  requires = [];

  constructor(options?: InsertTemporalSpreadOptions) {
    super(
      options || {
        durationThreshold: 35,
        placement: 'estimate',
        noteOffShiftTolerance: 500,
        scope: 'global',
      },
    );
  }

  /** The one group a call names, where it names one. */
  private group(): string | undefined {
    return 'group' in this.options ? this.options.group : undefined;
  }

  range(msm: Alignment): Range | undefined {
    if (spreadsGraces(this.options)) {
      const group = this.group();
      const row = group === undefined ? undefined : msm.graces.find((g) => g.group === group);
      return row === undefined ? undefined : rangeAt(row.date);
    }
    return 'date' in this.options ? rangeAt(this.options.date) : undefined;
  }

  /**
   * A chord's roll is fitted to the notes at its date, which is the default. A grace figure is
   * fitted to notes no date of the score holds, and names them.
   */
  override evidence(msm: Alignment, residual?: Residual): string[] {
    return spreadsGraces(this.options)
      ? graceEvidence(msm, this.options.scope, this.group())
      : super.evidence(msm, residual);
  }

  /**
   * The chords first, then the grace figures. A figure is measured from where its principal's
   * date sounds, and a roll over that date moves it: the chord is collapsed onto one onset, and
   * what was taken out of the principal is remembered on it (`AlignedNote.spread`). Measured
   * before that, the figure would be framed against an onset the chain no longer has.
   */
  override precedence(): number {
    return spreadsGraces(this.options) ? 1 : 0;
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    const spread = this.options;
    if (spreadsGraces(spread)) {
      spreadGraces(msm, mpm, spread.scope, this.group());
      return;
    }

    // Each ornament is written in two goes: what MPM lets an `<ornament>` say, and the
    // `<temporalSpread>` fields that have no place on one and are parked on its element for
    // `StylizeOrnamentation` to collect.
    const ornaments: { options: AddOrnamentOptions; draft: OrnamentDraft }[] = [];

    const score = msm.in(spread.scope);
    const chords = score.chords();
    for (const [date, chordNotes] of chords) {
      if ('date' in spread && date !== spread.date) {
        // if a date is specified, only process that date
        continue;
      }

      // only consider notes with a defined onset time
      const arpeggioNotes = chordNotes.filter((note) => isDefined(note['milliseconds.date']));

      // Less than two notes cannot be arpeggiated
      if (arpeggioNotes.length < 2) continue;

      const sortedByOnset = arpeggioNotes.sort(
        (a, b) => a['milliseconds.date'] - b['milliseconds.date'],
      );
      const firstNote = elementAt(sortedByOnset, 0, 'the arpeggiated chord');
      const lastNote = elementAt(sortedByOnset, sortedByOnset.length - 1, 'the arpeggiated chord');

      // Which notes the roll visits, and in what order. Shared with `InsertDynamicsGradient`,
      // which measures its ramp along the same sequence and writes the same attribute.
      const noteOrder = noteOrderOf(sortedByOnset, [
        ...score.tiedPrincipalsAt(date),
        ...score.straysAt(date),
      ]);

      // the arpeggio's duration is the time distance between first and last onset, in ms
      const duration = lastNote['milliseconds.date'] - firstNote['milliseconds.date'];
      if ('durationThreshold' in spread) {
        if (duration <= (spread.durationThreshold || 0)) continue;
      }

      // by default, no offset shifting is applied
      let noteOffShift: NoteOffShift = NoteOffShift.False;

      const sortedByOffset = sortedByOnset
        .slice()
        .sort((a, b) => a['milliseconds.date.end'] - b['milliseconds.date.end']);
      const sameOrder = sortedByOnset.every((note, i) => note === sortedByOffset[i]);

      const offsetScaleTolerance = 0.8;
      const minOffsetDistance = duration * offsetScaleTolerance;
      if (
        lastNote['milliseconds.date.end'] - firstNote['milliseconds.date.end'] >
          minOffsetDistance &&
        sameOrder
      ) {
        noteOffShift = NoteOffShift.True;
      }

      // in ms: how far a release may sit from the next onset and still count as one
      // note giving way to the next
      const monophonicTolerance = 20;
      const isMonophonic = pairwise(sortedByOnset).every(
        ([prev, curr]) =>
          Math.abs(prev['milliseconds.date.end'] - curr['milliseconds.date']) <=
          monophonicTolerance,
      );

      if (isMonophonic) {
        noteOffShift = NoteOffShift.Monophonic;
      }

      // define the frame start based on the given option
      const frameLength = duration;
      let frameStart: number, newOnset: number;

      const placement = spread.placement;

      if (placement === 'none') {
        // leave everything as it is
        continue;
      } else if (placement === 'on-beat') {
        frameStart = 0;
        newOnset = firstNote['milliseconds.date'];
      } else if (placement === 'before-beat') {
        frameStart = -frameLength;
        newOnset = lastNote['milliseconds.date'];
      } else {
        // the estimated onset is the average of all onsets
        newOnset =
          sortedByOnset.map((note) => note['milliseconds.date']).reduce((a, b) => a + b, 0) /
          arpeggioNotes.length;

        // frame start is the distance between the first note's onset and the estimated onset
        frameStart = firstNote['milliseconds.date'] - newOnset;
      }

      // determine the ornament's intensity
      const normalizedOnsets = sortedByOnset
        .map((note) => note['milliseconds.date'])
        .map((onset) => (onset - firstNote['milliseconds.date']) / duration);

      const intensity = determineIntensity(normalizedOnsets);

      ornaments.push({
        options: {
          id: generateId('ornament', date, mpm),
          date,
          nameRef: 'neutralArpeggio',
          noteOrder,
        },
        draft: {
          noteOffShift,
          frameStart,
          frameLength,
          frameDomain: FrameDomain.Milliseconds,
          intensity: intensity === 1 ? undefined : intensity,
        },
      });

      // The spread is now the ornament's to render, so the chord is collapsed onto one
      // onset. Each release travels the same distance as its onset: what is taken out here
      // is the stagger, not the length the note was held for.
      // What is taken out is remembered on the note: see `AlignedNote.spread`.
      sortedByOnset.forEach((note) => {
        note['milliseconds.date.end'] += newOnset - note['milliseconds.date'];
        note.spread = (note.spread ?? 0) + note['milliseconds.date'] - newOnset;
        note['milliseconds.date'] = newOnset;
      });
    }

    // `fillInAt`, not `addOrnamentV3`: `InsertDynamicsGradient` may already have written
    // the ornament at this date, and the two describe one element between them.
    const map = requireMap(mpm, 'ornament', spread.scope);
    for (const { options, draft } of ornaments) {
      setOrnamentDraft(
        fillInAt(map, options, {
          localName: 'ornament',
          add: (o) => map.addOrnamentV3(o),
          read: (i) => map.getOrnamentOptionsOf(i),
          update: (i, patch) => map.updateOrnamentAt(i, patch),
        }),
        draft,
      );
    }
  }
}
