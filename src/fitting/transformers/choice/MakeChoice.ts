import { Alignment, type AlignedNote } from '../../alignment';
import { AbstractTransformer, type ScopedTransformationOptions } from '../Transformer';

export interface RangeChoice {
  from: number;
  to: number;
}

export interface NoteChoice {
  noteIDs: string[];
}

export type AnyChoice = RangeChoice | NoteChoice;

export type Preference =
  | {
      prefer: string;
    }
  | {
      velocity: string;
      timing: string;
      pedalling: string;
    };

export type MakeChoiceOptions =
  | (ScopedTransformationOptions & ((RangeChoice | NoteChoice) & Preference)) // single choice
  | Preference; // default choice

export class MakeChoice extends AbstractTransformer<MakeChoiceOptions> {
  name = 'MakeChoice';
  requires = [];

  constructor(options?: MakeChoiceOptions) {
    super(
      options || {
        prefer: '',
        scope: 'global',
      },
    );
  }

  protected transform(msm: Alignment): void {
    let affected: AlignedNote[] = [];

    // (1) range mode
    if ('from' in this.options && 'to' in this.options) {
      // select all ntoes within the range
      affected = msm.allNotes.filter((note) => {
        if (!note.source) return false;

        const { from, to } = this.options as RangeChoice;
        return note.date >= from && note.date <= to;
      });
    }

    // (2) note mode
    else if ('noteIDs' in this.options) {
      affected = msm.allNotes.filter((note) => {
        if (!note.source) return false;
        const { noteIDs } = this.options as NoteChoice;
        return noteIDs.includes(note['xml:id']);
      });
    }

    // (3) default choice mode
    else {
      affected = msm.allNotes;
    }

    const velocityPreference =
      'prefer' in this.options ? this.options.prefer : this.options.velocity;
    const timingPreference = 'prefer' in this.options ? this.options.prefer : this.options.timing;
    const pedallingPreference =
      'prefer' in this.options ? this.options.prefer : this.options.pedalling;

    const equivalents = Map.groupBy(
      affected,
      (note) => `${note.date}-${note.duration}-${note['midi.pitch']}`,
    );

    // The removals are collected and applied in one pass. Splicing each variant out
    // individually is an `indexOf` scan plus a shift of the tail per note — quadratic in the
    // score, and every note of every chosen group pays it.
    const discarded = new Set<AlignedNote>();
    const chosen: AlignedNote[] = [];

    for (const notes of equivalents.values()) {
      const prototype = notes.find((note) => note.source === timingPreference);
      if (!prototype) continue;

      if (velocityPreference !== timingPreference) {
        const velocitySource = notes.find((note) => note.source === velocityPreference);
        if (velocitySource) {
          prototype.velocity = velocitySource.velocity;
        }
      }

      // keep only the prototype note and remove all source variants
      for (const note of notes) {
        discarded.add(note);
      }
      chosen.push({ ...prototype });
    }

    if (discarded.size > 0) {
      // Group order is iteration order, so the kept notes land at the end in the order
      // their groups were visited.
      msm.allNotes = msm.allNotes.filter((note) => !discarded.has(note)).concat(chosen);
    }

    if (pedallingPreference) {
      // The range is not applied to pedals. Comparing `pedal.date` against it does nothing:
      // nothing writes a symbolic date onto a pedal — the field is optional and left unset
      // by every producer — so the comparison is `undefined < number`, false, and every
      // pedal falls through to the source test regardless of the range. Said plainly, a
      // ranged branch and an unranged one are the same filter, so there is one. Giving
      // pedals a symbolic position is a change of its own; they are placed in milliseconds
      // only.
      //
      // Filtered rather than spliced, too: splicing out of the array being iterated skips
      // the element after each removal, so two adjacent pedals from the rejected source
      // would leave the second one in.
      msm.pedals = msm.pedals.filter((pedal) => pedal.source === pedallingPreference);
    }
  }
}
