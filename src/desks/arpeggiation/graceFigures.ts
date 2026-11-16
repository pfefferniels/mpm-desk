import type { AlignedGrace, AlignedNote, Alignment } from '../../fitting/alignment';
import type { Scope } from '../../fitting/instructions/index';

/**
 * The colour of a grace figure, wherever a desk draws one beside the rolls.
 *
 * A grace figure is an ornament like an arpeggio: fitted off the recording, framed in ticks,
 * given a definition by the Styles desk. So the arpeggiation desks draw both, and this is what
 * tells them apart at a glance. Away from the red a chord's roll is drawn in, the grey of a
 * written spread and the blue the desks keep for what is selected (`../evidence.ts`).
 */
export const GRACE_COLOUR = '#0d9488';

/** One grace group as the recording timed it, read off the alignment the chain left. */
export interface GraceFigure {
  group: string;
  /** The principal's date, which is the date its ornament is written at. */
  date: number;
  principal: string;
  /** The group's grace notes in the order they were struck, the one tied into the principal too. */
  graces: AlignedGrace[];
  /** The group's grace notes and its principal, by `xml:id`: what evidence names. */
  ids: string[];
  tied: boolean;
  /**
   * Where the principal was struck, in ms: as the grace note tied into it, or on its own, where
   * an arpeggio fit has not left it (`AlignedNote.spread`). Absent without a strike to measure to.
   */
  strike: number | undefined;
  /** How many takes time the group. More than one, and a reading has yet to be chosen. */
  readings: number;
}

/** The grace groups of a scope, in score order. */
export const graceFiguresOf = (msm: Alignment, scope: Scope): GraceFigure[] => {
  const inScope = msm.graces.filter((grace) => scope === 'global' || grace.part - 1 === scope);

  // Where a principal sounded: an arpeggio fit has collapsed its chord, and remembers by how much.
  const onsetOf = (id: string): number | undefined => {
    const note = msm.allNotes.find((candidate) => candidate['xml:id'] === id);
    return note === undefined ? undefined : note['milliseconds.date'] + (note.spread ?? 0);
  };

  return [...Map.groupBy(inScope, (grace) => grace.group)]
    .map(([group, rows]) => {
      const graces = [...rows].sort(
        (a, b) => a.slot - b.slot || a['milliseconds.date'] - b['milliseconds.date'],
      );
      const first = graces[0];
      const tied = graces.find((row) => row.tied);
      const principal = first?.principal ?? '';
      return {
        group,
        date: first?.date ?? 0,
        principal,
        graces,
        ids: [...rows.map((row) => row['xml:id']), principal],
        tied: tied !== undefined,
        strike: tied?.['milliseconds.date'] ?? onsetOf(principal),
        readings: new Set(rows.map((row) => row.source ?? '')).size,
      };
    })
    .sort((a, b) => a.date - b.date);
};

/** From a figure's first grace note to its principal's strike, in ms; null with nothing to measure to. */
export const leadOf = ({ graces, strike }: GraceFigure): number | null => {
  const first = graces[0];
  return first === undefined || strike === undefined ? null : strike - first['milliseconds.date'];
};

/**
 * A grace note as a note a desk can sound.
 *
 * `asMIDI` reads a pitch, a velocity and the two times, and is typed for a score note, which a
 * grace note is not: it has no staff, layer or spelling in the alignment, and no time of its own
 * in the score. What it lacks is stated empty here, once, where a desk would otherwise cast.
 */
const soundable = (grace: AlignedGrace): AlignedNote => ({
  'xml:id': grace['xml:id'],
  part: grace.part,
  staff: '',
  layer: '',
  date: grace.date,
  duration: 0,
  pitchname: '',
  accidentals: 0,
  octave: 0,
  'midi.pitch': grace['midi.pitch'],
  velocity: grace.velocity,
  'milliseconds.date': grace['milliseconds.date'],
  'milliseconds.date.end': grace['milliseconds.date.end'],
});

/**
 * A figure's notes as the recording sounded them, in the order it struck them: the grace notes,
 * then the principal.
 *
 * A principal a grace note is tied into is that grace note, struck early and held, under the
 * principal's own id, which is the one the ornament's `@note.order` ends on. One struck on its
 * own is put back where it sounded, an arpeggio fit having moved its row onto the chord's onset.
 *
 * @param principal the principal's row, where the alignment has one
 */
export const soundingNotesOf = (figure: GraceFigure, principal?: AlignedNote): AlignedNote[] => {
  const tied = figure.graces.find((grace) => grace.tied);
  const struck =
    tied !== undefined
      ? [{ ...soundable(tied), 'xml:id': figure.principal }]
      : principal !== undefined && figure.strike !== undefined
        ? [
            {
              ...principal,
              'milliseconds.date': figure.strike,
              'milliseconds.date.end':
                figure.strike + principal['milliseconds.date.end'] - principal['milliseconds.date'],
            },
          ]
        : [];
  return [...figure.graces.filter((grace) => !grace.tied).map(soundable), ...struck];
};
