/**
 * The order an arpeggio's notes were struck in, written the way `@note.order` states it.
 *
 * Both halves of an `<ornament>` are measured along the roll: `InsertTemporalSpread` fits the
 * stagger between consecutive onsets, and `InsertDynamicsGradient` reads its ramp off the
 * velocities of the first and last note struck. Neither measurement means anything until the
 * element also says which notes those are and in what order — and MPM has exactly one place to
 * say it, `@note.order`, which the two transformers share along with everything else on the
 * element.
 *
 * So it is computed here, from the chord, rather than by whichever of them happens to write the
 * element first. `fillInAt` lets the earlier one win, and two transformers deriving the same
 * attribute from the same chord by two routes is a disagreement waiting to be introduced by an
 * edit to one of them.
 *
 * ## Why an absent attribute is not a neutral one
 *
 * espressivo renders an `<ornament>` with no `@note.order` by collecting every note at its date
 * and sorting them by **ascending pitch** (`OrnamentationMap.apply`, which leaves
 * `noteOrderAscending = 1` when the attribute is missing). That is a real sequence, not an
 * abstention, and it is the recording's own only for a chord rolled from the bottom up. Left off
 * a ramp fitted along onsets it silently lands the ramp on the wrong notes — see issue #20,
 * where three ornaments of the shipped reconstruction had no `@note.order` because no temporal
 * spread had been asked for over them, and one of the three rolled 48 55 67 60 64.
 */
import { head, isNonEmpty, pairwise } from 'espressivo';
import type { AlignedNote } from '../../alignment';

/**
 * A little helper function to determine how an array is sorted.
 *
 * @param arr The array to check
 * @returns -1 if the array is sorted in descending order, 1 if its
 * sorted in ascending order, 0 if it isn't sorted.
 */
const determineSortDirection = (arr: number[]) => {
  const steps = pairwise(arr);
  if (!isNonEmpty(steps)) return 0;

  const [firstFrom, firstTo] = head(steps);
  const direction = Math.sign(firstTo - firstFrom);
  return steps.every(([from, to]) => Math.sign(to - from) === direction) ? direction : 0;
};

/**
 * `@note.order` for a chord **already sorted by onset**, which is the order every fit over it
 * was measured in.
 *
 * The two pitch keywords are preferred where they hold, because they are what a reader of the
 * document can see the roll in: `note.order="ascending pitch"` says the chord went up, while a
 * list of eight ids says only that somebody measured something. They hold exactly when pitch
 * moves the same way at every step — a repeated pitch is a step of zero and breaks the run, so a
 * doubled note falls to the list rather than being smoothed over.
 *
 * The list is the general answer and is always available: it names the notes by `xml:id` in the
 * order they were struck, which is what was measured, whatever the pitches did. Its one cost is
 * that it names *these* notes and no others, where a keyword takes every note at the date — the
 * right side of that trade for a fit that only measured the notes it could see an onset for.
 */
export const noteOrderOf = (sortedByOnset: readonly AlignedNote[]): string => {
  const direction = determineSortDirection(sortedByOnset.map((note) => note['midi.pitch']));
  if (direction === 1) return 'ascending pitch';
  if (direction === -1) return 'descending pitch';
  return sortedByOnset.map((note) => `#${note['xml:id']}`).join(' ');
};

/**
 * The notes an `<ornament>` visits, in the order it says to visit them — the reader to
 * {@link noteOrderOf}'s writer.
 *
 * Mirrors espressivo's own reading (`OrnamentationMap.readNoteOrder` and the sort in `apply`):
 * the two keywords sort the chord by pitch, and anything else is a whitespace-separated list of
 * ids, `#` prefixes stripped, naming the notes in order. **An absent attribute sorts by
 * ascending pitch**, because that is what the renderer does with one — reading it as "no opinion"
 * is the mistake this module exists to stop.
 *
 * @param notes every note at the ornament's date, in any order
 * @returns the named notes, in the stated order; notes the list does not name are left out, as
 * the renderer leaves them out. A list that names none of them falls back to the ascending
 * default rather than to nothing: for an audition, the chord in some order beats silence, and
 * the renderer would have skipped the ornament outright.
 */
export const sequenceOf = (
  noteOrder: string | readonly string[] | undefined,
  notes: readonly AlignedNote[],
): AlignedNote[] => {
  const stated = (typeof noteOrder === 'string' ? noteOrder : (noteOrder ?? []).join(' ')).trim();
  const byPitch = (descending: boolean) =>
    [...notes].sort((a, b) =>
      descending ? b['midi.pitch'] - a['midi.pitch'] : a['midi.pitch'] - b['midi.pitch'],
    );

  if (stated === 'descending pitch') return byPitch(true);
  if (stated === '' || stated === 'ascending pitch') return byPitch(false);

  const byId = new Map(notes.map((note) => [note['xml:id'], note]));
  const named = stated
    .replace(/#/g, '')
    .split(/\s+/)
    .map((id) => byId.get(id))
    .filter((note): note is AlignedNote => note !== undefined);

  return named.length === 0 ? byPitch(false) : named;
};
