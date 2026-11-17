import { FrameDomain, NoteOffShift, OrnamentNote } from 'espressivo';
import {
  Mpm,
  getInstructions,
  requireElement,
  requireMap,
  setOrnamentDraft,
} from '../../instructions/index';
import type { Scope } from '../../instructions/index';
import type { AlignedGrace, Alignment } from '../../alignment';
import { determineIntensity } from './intensity';

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
 * Which grace notes a spread of {@link scope} is about: those of one group, or of every group the
 * recording timed there.
 *
 * @param group one group, by the `xml:id` of its `graceGrp` (or grace chord); absent, every one
 */
const gracesOf = (msm: Alignment, scope: Scope, group?: string): AlignedGrace[] =>
  msm.graces.filter(
    (grace) =>
      (scope === 'global' || grace.part - 1 === scope) &&
      (group === undefined || grace.group === group),
  );

/**
 * What a grace figure's spread is measured from: the recorded grace notes of its group, or of
 * every group in its scope, and the principals they lead into. Not the notes at the principal's
 * date, which a chord's spread reads, since a grace note is in no chord of the MSM.
 */
export const graceEvidence = (msm: Alignment, scope: Scope, group?: string): string[] => {
  const graces = gracesOf(msm, scope, group);
  return [
    ...new Set([
      ...graces.map((grace) => grace['xml:id']),
      ...graces.map((grace) => grace.principal),
    ]),
  ];
};

/**
 * Spreads the score's grace notes as the recording played them: one MPM v3 `<ornament>` per
 * group, its notes the pool, the note it decorates its `@noteid`, the whole figure placed in time
 * from the recorded onsets.
 *
 * The other half of `InsertTemporalSpread`, beside a chord's roll. Both measure a frame and the
 * spacing of the onsets within it, and both leave them to the same later steps. What differs is
 * where the notes are: a roll spreads notes the score has on one date, and a grace note takes no
 * time, so the MSM has no note for it and no fitter before this has seen it; `asMSM` reads them
 * into `Alignment.graces` from what espressivo reports the conversion left out. The ornament is
 * how MPM v3 gives them back: espressivo replaces the principal by the figure, grace notes first
 * and the principal last. And where a roll takes its stagger out of the recording, this takes
 * nothing: the notes after it are where they were.
 *
 * It was a transformer of its own until November 2026, `InsertGraceNotes`, the only one named
 * after what it read in the score and not after what it wrote into the MPM. A call saved under
 * that name is read as the spread it is (`src/model/Work.ts`).
 *
 * ## Where the figure is measured from
 *
 * The renderer lays the figure out from the principal's *date* as the tempo puts it — not from
 * where an arpeggio would have put the principal, since the figure takes the principal's place
 * in that arpeggio and the arpeggio's offset is not inherited. So the frame is measured from the
 * onset the chain gives the principal's date, which after a chord's spread is the chord's
 * collapsed onset, and a figure is spread after the chords are (`InsertTemporalSpread.precedence`).
 *
 * - **Untied**: the principal keeps its own onset — the collapsed one plus the stagger the spread
 *   took out of it (`AlignedNote.spread`) — and the grace notes come before it.
 * - **Tied**: the last grace note is tied into the principal, which is then struck as that note
 *   and held. The tied grace note's onset is the principal's, and the score has no second one;
 *   the date's onset is read off the other notes the chord has there. The principal has no row
 *   of its own and is in the rendered score as one of `Alignment.tiedPrincipals`.
 *
 * ## What becomes of the frame
 *
 * What a roll's does. The frame is measured here, in milliseconds, and parked on the
 * `<ornament>` as a draft (`ornamentDraft.ts`); `TranslatePhysicalTimeToTicks` puts it into ticks
 * and `StylizeOrnamentation` gives the figure a definition, its own or one it shares with every
 * ornament framed alike. Until that has run the figure names no definition and is silent, as an
 * unstylized arpeggio is.
 *
 * It did not always go that way. A grace note's lead reaches back from its principal across the
 * beat before, often across a barline and so across a `<tempo>`, and the hinge used to convert a
 * frame along the tempo map as the recording anchors it, which is not where the renderer plays
 * it back: WM 225's bar 18, the C before the F of `ritard.`, leads by 632 ms on the roll and came
 * out 838 ms ahead. So each group was given a definition of its own here, in milliseconds. The
 * hinge now measures a figure along the tempo map as the renderer walks it, and the lead comes
 * back as measured.
 *
 * In ticks a figure's notes are notes of the score where the frame puts them, so a `<rubato>`
 * over that stretch moves them with the rest. The hinge allows for that too, which is why it
 * runs after the rubato fitters: it writes the frame so that the warp lands each end of the
 * figure where it was played.
 *
 * Each grace note gives way to the next and the principal sounds to its own end
 * (`noteoff.shift="monophonic"`); the spacing between three or more onsets is fitted as
 * `@intensity`. The figure takes the principal's velocity: no dynamics gradient is fitted.
 *
 * A group is skipped, with a reason, while its readings are still side by side, when the
 * recording strikes its principal neither on its own nor through a tied grace note, and when
 * nothing the chain can place sounds on its principal's date.
 *
 * @param only one group, by the `xml:id` of its `graceGrp` (or grace chord); absent, every one
 */
export const spreadGraces = (msm: Alignment, mpm: Mpm, scope: Scope, only?: string): void => {
  const groups = Map.groupBy(gracesOf(msm, scope, only), (grace) => grace.group);
  if (groups.size === 0) return;

  const map = requireMap(mpm, 'ornament', scope);

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
      console.warn(`InsertTemporalSpread: ${group} has more than one reading; choose one first`);
      continue;
    }
    const principal = principals[0];

    // The renderer plays the figure in its principal's place, so the principal has to be in
    // the score the MPM is rendered against: timed, or struck as the grace note tied into it.
    if (
      principal === undefined &&
      !msm.tiedPrincipals.some((note) => note['xml:id'] === principalId)
    ) {
      console.warn(
        `InsertTemporalSpread: ${group} leads to ${principalId}, which the recording does not strike`,
      );
      continue;
    }

    // Where the chain puts the principal's date.
    const atDate = msm.in(scope).notesAtDate(date);
    const reference = principal
      ? principal['milliseconds.date']
      : atDate.length > 0
        ? mean(atDate.map((note) => note['milliseconds.date']))
        : undefined;
    if (reference === undefined) {
      console.warn(`InsertTemporalSpread: nothing recorded sounds on ${group}'s date ${String(date)}`);
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

    const intensity =
      length > 0 ? determineIntensity(onsets.map((onset) => (onset - start) / length)) : 1;

    // Written in two goes, as `InsertTemporalSpread` writes an arpeggio: what MPM lets an
    // `<ornament>` say, then the `<temporalSpread>` fields that have no place on one, parked on
    // the element for the hinge to translate and `StylizeOrnamentation` to collect. Not through
    // `fillInAt`: the figure is an element of its own, beside whatever roll its date has.
    const element = requireElement(
      map,
      map.addOrnamentV3({
        id: ornamentIdFor(group, mpm),
        date,
        // The name no definition carries, which both arpeggio fitters leave too.
        nameRef: 'neutralArpeggio',
        noteid: `#${principalId}`,
        noteOrder: order,
        notes: pool.map(
          (row) => new OrnamentNote(row['xml:id'], { kind: 'midi', value: row['midi.pitch'] }),
        ),
      }),
      'ornament',
    );
    setOrnamentDraft(element, {
      noteOffShift: NoteOffShift.Monophonic,
      frameStart: start - reference,
      frameLength: length,
      frameDomain: FrameDomain.Milliseconds,
      intensity: intensity === 1 ? undefined : intensity,
    });
  }
};
