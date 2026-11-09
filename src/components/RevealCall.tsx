import { useEffect } from 'react';
import type { CallOutcome } from '../fitting/fit';
import { useScrollSync } from '../hooks/ScrollSyncProvider';
import { useLatest } from '../hooks/useLatest';

interface RevealCallProps {
    /**
     * The call just opened — by a link, by the hash changing, or by a click in the markup desk —
     * as a fresh object each time, so that opening the same call again scrolls to it again.
     */
    opened: { id: string };
    /** Where each call acted, off the last fit. Read when a call is opened, not followed. */
    outcomes: readonly CallOutcome[];
}

/**
 * Scroll the open desk to the call just opened, centred on where it acted.
 *
 * A call opened by a link is most often somewhere off the first screen, and a selection nobody
 * can see is one that appears not to have happened.
 *
 * Rendered after the desk and keyed on it, inside the same boundary, so it mounts in the commit
 * the desk does and its effect runs after the desk's own: the desk's scrollers are registered by
 * then, which is all `scrollToDate` needs. A refit does not scroll again, since only `opened`
 * says when to.
 */
export const RevealCall = ({ opened, outcomes }: RevealCallProps) => {
    const { scrollToDate } = useScrollSync();
    // Through a ref: `outcomes` changes with every refit, and a refit is not a reason to take the
    // reader somewhere.
    const outcomesRef = useLatest(outcomes);

    useEffect(() => {
        const range = outcomesRef.current.find((outcome) => outcome.id === opened.id)?.range;
        if (!range) return;
        scrollToDate((range.from + (range.to ?? range.from)) / 2);
    }, [opened, scrollToDate, outcomesRef]);

    return null;
};
