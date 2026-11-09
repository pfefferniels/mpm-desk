import { FrameDomain, NoteOffShift, OrnamentNote } from 'espressivo';
import {
  Mpm,
  OrnamentDef,
  ensureDefaultStyle,
  getInstructions,
  insertDefinition,
  requireMap,
} from '../../instructions/index';
import type { AlignedGrace, Alignment } from '../../alignment';
import { AbstractTransformer, type ScopedTransformationOptions } from '../Transformer';
import { type Range, rangeAt } from '../range';
import { determineIntensity } from './InsertTemporalSpread';

export type InsertGraceNotesOptions = ScopedTransformationOptions & {
  /**
   * One group, by the `xml:id` of its `graceGrp` (or grace chord). Absent, every group the
   * recording timed in the scope.
   */
  group?: string;
};

/** The `<ornament>` id a group's figure is written under, unique in the document. */
const ornamentIdFor = (group: string, mpm: Mpm): string => {
  const taken = new Set(getInstructions(mpm, 'ornament').map((instruction) => instruction.id));
  let candidate = `grace_${group}`;
  for (let n = 1; taken.has(candidate); n++) candidate = `grace_${group}_${String(n)}`;
  return candidate;
};

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Plays the score's grace notes as the recording played them: one MPM v3 `<ornament>` per group,
 * its notes the pool, the note it decorates its `@noteid`, the whole figure placed in time from
 * the recorded onsets.
 *
 * A grace note takes no time, so the MSM has no note for it and no fitter before this one has
 * seen it; `asMSM` reads them into `Alignment.graces` from what espressivo reports the
 * conversion left out. The ornament is how MPM v3 gives them back: espressivo replaces the
 * principal by the figure, grace notes first and the principal last.
 *
 * ## Where the figure is measured from
 *
 * The renderer lays the figure out from the principal's *date* as the tempo puts it — not from
 * where an arpeggio would have put the principal, since the figure takes the principal's place
 * in that arpeggio and the arpeggio's offset is not inherited. So the frame is measured from the
 * onset the chain gives the principal's date, which after `InsertTemporalSpread` is the chord's
 * collapsed onset, and this runs after it.
 *
 * - **Untied**: the principal keeps its own onset — the collapsed one plus the stagger the spread
 *   took out of it (`AlignedNote.spread`) — and the grace notes come before it.
 * - **Tied**: the last grace note is tied into the principal, which is then struck as that note
 *   and held. The tied grace note's onset is the principal's, and the score has no second one;
 *   the date's onset is read off the other notes the chord has there.
 *
 * ## Why the frame stays in milliseconds
 *
 * Each group gets a definition of its own, written here, with its frame in milliseconds — not a
 * draft for `TranslatePhysicalTimeToTicks` and `StylizeOrnamentation`, as an arpeggio's is. A grace
 * note's lead is a gesture of the hand, measured in time, and it reaches back from its principal
 * across the beat before, often across a barline. The hinge converts a frame through the tempo
 * map as the recording anchors it, while the renderer plays it back through the tempo model; the
 * two agree within a segment and part where a frame crosses a boundary the model does not meet
 * exactly. WM 225's bar 18 is the case: the C before the F of `ritard.` leads by 632 ms on the
 * roll, and came out 839 ms ahead in ticks. In milliseconds it is 632 again, and the frame reads
 * as what was measured. One definition per group, because a definition is a frame, and two grace
 * figures share one only by accident.
 *
 * Each grace note gives way to the next and the principal sounds to its own end
 * (`noteoff.shift="monophonic"`); the spacing between three or more onsets is fitted as
 * `@intensity`. The figure takes the principal's velocity: no dynamics gradient is fitted.
 *
 * A group is skipped, with a reason, while its readings are still side by side, and when nothing
 * the chain can place sounds on its principal's date.
 */
export class InsertGraceNotes extends AbstractTransformer<InsertGraceNotesOptions> {
  readonly name = 'InsertGraceNotes';
  requires = [];

  constructor(options?: InsertGraceNotesOptions) {
    super(options || { scope: 'global' });
  }

  range(msm: Alignment): Range | undefined {
    const { group } = this.options;
    if (group === undefined) return undefined;
    const row = msm.graces.find((grace) => grace.group === group);
    return row === undefined ? undefined : rangeAt(row.date);
  }

  private covers(grace: AlignedGrace): boolean {
    const { scope, group } = this.options;
    if (scope !== 'global' && grace.part - 1 !== scope) return false;
    return group === undefined || grace.group === group;
  }

  protected transform(msm: Alignment, mpm: Mpm): void {
    const groups = Map.groupBy(msm.graces.filter((grace) => this.covers(grace)), (g) => g.group);
    if (groups.size === 0) return;

    const map = requireMap(mpm, 'ornament', this.options.scope);

    for (const [group, rows] of groups) {
      const first = rows[0];
      if (first === undefined) continue;
      const { principal: principalId, date } = first;

      // One row per grace note and one per score note, or the readings are still unchosen.
      const principals = msm.allNotes.filter((note) => note['xml:id'] === principalId);
      if (
        new Set(rows.map((row) => row['xml:id'])).size !== rows.length ||
        principals.length > 1
      ) {
        console.warn(`InsertGraceNotes: ${group} has more than one reading; choose one first`);
        continue;
      }
      const principal = principals[0];

      // Where the chain puts the principal's date.
      const atDate = msm.in(this.options.scope).notesAtDate(date);
      const reference = principal
        ? principal['milliseconds.date']
        : atDate.length > 0
          ? mean(atDate.map((note) => note['milliseconds.date']))
          : undefined;
      if (reference === undefined) {
        console.warn(`InsertGraceNotes: nothing recorded sounds on ${group}'s date ${String(date)}`);
        continue;
      }

      const sorted = [...rows].sort(
        (a, b) => a.slot - b.slot || a['milliseconds.date'] - b['milliseconds.date'],
      );
      const tied = sorted.find((row) => row.tied);
      const pool = sorted.filter((row) => !row.tied);
      const slots = [...Map.groupBy(pool, (row) => row.slot).values()];

      const principalOnset = tied
        ? tied['milliseconds.date']
        : reference + (principal?.spread ?? 0);
      const onsets = [
        ...slots.map((slot) => mean(slot.map((row) => row['milliseconds.date']))),
        principalOnset,
      ];
      const start = onsets[0] ?? principalOnset;
      const length = Math.max(0, principalOnset - start);

      const order = [
        ...slots.map((slot) =>
          slot.length === 1
            ? `#${slot[0]?.['xml:id'] ?? ''}`
            : `[ ${slot.map((row) => `#${row['xml:id']}`).join(' ')} ]`,
        ),
        `#${principalId}`,
      ].join(' ');

      const id = ornamentIdFor(group, mpm);
      // Named after its ornament, as `StylizeOrnamentation` names a definition it makes for one.
      const built = OrnamentDef.createOrnamentDef(`def_${String(this.options.scope)}_${id}`);
      if (!built.ok) {
        console.warn(`InsertGraceNotes: no definition can be named after ${id}`);
        continue;
      }
      const def = built.value;
      const intensity =
        length > 0 ? determineIntensity(onsets.map((onset) => (onset - start) / length)) : 1;
      def.setTemporalSpreadValues(
        start - reference,
        length,
        FrameDomain.Milliseconds,
        intensity,
        NoteOffShift.Monophonic,
      );
      insertDefinition(mpm, 'ornamentDef', def, this.options.scope);
      ensureDefaultStyle(mpm, 'ornament', this.options.scope);

      map.addOrnamentV3({
        id,
        date,
        nameRef: def.getName(),
        noteid: `#${principalId}`,
        noteOrder: order,
        notes: pool.map(
          (row) => new OrnamentNote(row['xml:id'], { kind: 'midi', value: row['midi.pitch'] }),
        ),
      });
    }
  }
}
