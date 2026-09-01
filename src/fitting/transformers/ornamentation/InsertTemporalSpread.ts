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
import { isDefined } from '../../utils';
import { elementAt, foldl, pairwise } from 'espressivo';
import {
  AbstractTransformer,
  generateId,
  type ScopedTransformationOptions,
} from '../Transformer';
import { noteOrderOf } from './noteOrder';

export type ArpeggioPlacement = 'on-beat' | 'before-beat' | 'estimate' | 'none';
export type DatedArpeggioPlacement = Map<number, ArpeggioPlacement>;

// onsets is a sorted array normalized to [0, 1]
export const determineIntensity = (onsets: number[]): number => {
  const n = onsets.length;
  // intensity only makes sense for more than 2 notes
  if (n <= 2) return 1;

  // The error function we want to minimize.
  const error = (intensity: number): number =>
    foldl(onsets, 0, (sum, onset, i) => {
      const diff = onset - Math.pow(i / (n - 1), intensity);
      return sum + diff * diff;
    });

  // Search bounds. TODO: make these configurable.
  let lower = 0.1,
    upper = 5.0;
  const tol = 1e-6;
  const goldenRatio = (Math.sqrt(5) + 1) / 2;

  let c = upper - (upper - lower) / goldenRatio;
  let d = lower + (upper - lower) / goldenRatio;

  // Continue refining the bounds until convergence.
  while (upper - lower > tol) {
    if (error(c) < error(d)) {
      upper = d;
    } else {
      lower = c;
    }
    c = upper - (upper - lower) / goldenRatio;
    d = lower + (upper - lower) / goldenRatio;
  }

  return (lower + upper) / 2;
};

export type InsertTemporalSpreadOptions = ScopedTransformationOptions & {
  placement: ArpeggioPlacement;
  noteOffShiftTolerance: number;
} & ({ date: number } | { durationThreshold: number });

/**
 * Interpolates arpeggiated chords as ornaments, inserts them as physical
 * values into the MPM and substracts accordingly from the recorded onsets, so
 * that after the transformation all notes of the chord will have the same
 * onset.
 */
export class InsertTemporalSpread extends AbstractTransformer<InsertTemporalSpreadOptions> {
  name = 'InsertTemporalSpread';
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

  protected transform(msm: Alignment, mpm: Mpm): void {
    // Each ornament is written in two goes: what MPM lets an `<ornament>` say, and the
    // `<temporalSpread>` fields that have no place on one and are parked on its element for
    // `StylizeOrnamentation` to collect.
    const ornaments: { options: AddOrnamentOptions; draft: OrnamentDraft }[] = [];

    const chords = msm.in(this.options.scope).chords();
    for (const [date, chordNotes] of chords) {
      if ('date' in this.options && date !== this.options.date) {
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
      const noteOrder = noteOrderOf(sortedByOnset);

      // the arpeggio's duration is the time distance between first and last onset, in ms
      const duration = lastNote['milliseconds.date'] - firstNote['milliseconds.date'];
      if ('durationThreshold' in this.options) {
        if (duration <= (this.options.durationThreshold || 0)) continue;
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

      const placement = this.options.placement;

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
      sortedByOnset.forEach((note) => {
        note['milliseconds.date.end'] += newOnset - note['milliseconds.date'];
        note['milliseconds.date'] = newOnset;
      });
    }

    // `fillInAt`, not `addOrnamentV3`: `InsertDynamicsGradient` may already have written
    // the ornament at this date, and the two describe one element between them.
    const map = requireMap(mpm, 'ornament', this.options.scope);
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
