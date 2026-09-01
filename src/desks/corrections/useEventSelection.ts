import { useCallback, useMemo, useState } from 'react';
import type { Alignment } from '../../fitting/alignment';
import type { Scope } from '../../fitting/instructions/index';
import type { ModifySelector } from '../../fitting/transformers/modification/Modify';
import { rangeCovering, reachedTo } from '../dateRange';

/** What was clicked. A pedal has no symbolic date, which is why only a note carries one. */
export type Clicked = { kind: 'note'; id: string; date: number } | { kind: 'pedal'; id: string };

/** The two keys that mean something on a plot of events, and nothing else about the event. */
export interface SelectionModifiers {
    metaKey: boolean;
    shiftKey: boolean;
}

/**
 * Which events a correction is about, and the three clicks that say so.
 *
 * - plain click — this one, and nothing else
 * - cmd/ctrl click — add to what is selected, as a list of ids
 * - shift click — reach from what is selected to here, as a stretch of the tick grid
 *
 * The three produce the three arms of {@link ModifySelector} directly, so what the user drew and
 * what the call says are the same thing rather than one being derived from the other. A shift
 * click over a list of notes converts it into the stretch spanning that list and the click; over a
 * stretch it moves whichever end is nearer, so the same gesture reaches out or pulls back in.
 * Either way the ends come out in the grid's order — see `dateRange`, and issue #26 for what an
 * inverted pair costs.
 *
 * **Pedals only ever form a list.** `from`/`to` is a stretch of the score, and a recorded pedal
 * has no place on the score — so shift over a pedal adds it to the list instead of reaching.
 *
 * ## A plain press means one of two things
 *
 * Outside the selection it replaces it; **inside it, it changes nothing**, because that press is
 * also the start of a drag and a group has to be draggable by any of its members. The dynamics
 * desk had the second half of that rule and not the first: a plain click with a selection
 * standing fell through every branch and did nothing at all, so there was no way to start a new
 * selection short of committing or abandoning the old one. `ChoiceDesk` — the other desk that
 * edits the recording — has always replaced.
 */
export const useEventSelection = (msm: Alignment, part: Scope) => {
    const [selection, setSelection] = useState<ModifySelector>();

    /** Whether a selector already reaches this id — asked of `current` inside the updater. */
    const covers = useCallback(
        (selector: ModifySelector, id: string) => coveredBy(selector, msm, part).has(id),
        [msm, part],
    );

    const select = useCallback(
        (clicked: Clicked, modifiers: SelectionModifiers) => {
            setSelection((current) => {
                if (clicked.kind === 'pedal') {
                    const held = current && 'pedalIDs' in current ? current.pedalIDs : undefined;
                    if (!held) return { pedalIDs: [clicked.id] };
                    if (!(modifiers.metaKey || modifiers.shiftKey))
                        // As for notes: a plain press inside the selection keeps it, so the
                        // whole group can be dragged by any one of its lanes.
                        return held.includes(clicked.id) ? current : { pedalIDs: [clicked.id] };
                    // A second click on a pedal already in the list takes it back out, so the
                    // same gesture that added it undoes the addition.
                    return {
                        pedalIDs: held.includes(clicked.id)
                            ? held.filter((id) => id !== clicked.id)
                            : [...held, clicked.id],
                    };
                }

                if (!current || 'pedalIDs' in current) return { noteIDs: [clicked.id] };

                // A press on something already selected leaves the selection alone, so that a
                // group can be dragged by any of its members. Without it the press that begins
                // the drag would first throw away everything but the one event under the cursor.
                if (!modifiers.metaKey && !modifiers.shiftKey && covers(current, clicked.id))
                    return current;

                if (modifiers.metaKey && 'noteIDs' in current) {
                    // A new array, because the spread is shallow: pushing into the old one would
                    // carry the same array into the "new" selection, and a consumer comparing
                    // references would see no change.
                    return current.noteIDs.includes(clicked.id)
                        ? { noteIDs: current.noteIDs.filter((id) => id !== clicked.id) }
                        : { noteIDs: [...current.noteIDs, clicked.id] };
                }

                if (modifiers.shiftKey) {
                    if (!('noteIDs' in current)) return reachedTo(current, clicked.date);
                    const dates = current.noteIDs
                        .map((id) => msm.getByID(id)?.date)
                        .filter((date): date is number => date !== undefined);
                    if (!dates.length) return { noteIDs: [clicked.id] };
                    return rangeCovering(clicked.date, ...dates);
                }

                return { noteIDs: [clicked.id] };
            });
        },
        [msm, covers],
    );

    const clear = useCallback(() => setSelection(undefined), []);

    /**
     * The ids the selection reaches, resolved once per selection rather than per drawn event.
     *
     * A range names dates, not ids, so answering "is this note in it?" per note is a walk over
     * every note per note — which is the shape that made the dynamics desk's `isNoteAffected`
     * quadratic in the piece.
     */
    const selected = useMemo(
        () => coveredBy(selection, msm, part),
        [selection, msm, part],
    );

    return { selection, setSelection, select, clear, selected };
};

/** The same question about a selector nobody is holding — what a pending call still covers. */
export const coveredBy = (
    selector: ModifySelector | undefined,
    msm: Alignment,
    part: Scope,
): ReadonlySet<string> => {
    if (!selector) return new Set();
    if ('noteIDs' in selector) return new Set(selector.noteIDs);
    if ('pedalIDs' in selector) return new Set(selector.pedalIDs);
    return new Set(msm.in(part).notesInRange(selector.from, selector.to).map((n) => n['xml:id']));
};
