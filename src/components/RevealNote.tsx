import { useEffect } from 'react';
import type { Followed } from '../hooks/FollowBack';
import { useScrollSync } from '../hooks/ScrollSyncProvider';

/**
 * Scroll Base Text to the notes just followed to it, centred on where they are struck.
 *
 * Rendered after the desk and keyed on it, as `RevealCall` is and for its reason: its effect runs
 * after the desk's own, once the desk's scroller is registered. Rendered after `RevealCall` too,
 * so that where a call is selected as well, the notes the reader clicked are what is brought into
 * view rather than the middle of the call.
 */
export const RevealNote = ({ followed }: { followed: Followed }) => {
    const { scrollToDate } = useScrollSync();

    useEffect(() => {
        scrollToDate(followed.date);
    }, [followed, scrollToDate]);

    return null;
};
