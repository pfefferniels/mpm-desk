import { useEffect, useEffectEvent } from 'react';
import {
    instructionsEffectiveAtDate,
    instructionTypes,
    type Mpm,
} from '../fitting/instructions/index';
import { usePlayback, type PlaybackNoteEvent } from '../hooks/PlaybackProvider';
import { useCallSelection } from '../hooks/CallSelection';
import { useScrollSync } from '../hooks/ScrollSyncProvider';
import { setsEqual } from '../utils/utils';

interface FollowPlaybackProps {
    mpm: Mpm;
    /** The time-signature denominator an `<accentuationPattern>`'s length is counted against. */
    beatDenominator: number;
}

/**
 * The editor following the playhead: the calls whose instructions are sounding become the
 * selected ones, and the desk scrolls along.
 *
 * Renders nothing. It is a subscriber rather than an option on `play()` because who plays and
 * who follows are different questions: the play button sits in the app bar, and what following
 * means depends on which desk is open. A desk that plots one dimension wants the sounding calls
 * lit on its plot, which is what selecting them does. The narrative desk wants its rows lit and
 * its selection left alone — there the selection is the grouping in progress — so it follows
 * on its own and this is not mounted with it.
 *
 * Which calls are sounding is what is in effect at the note's date, kind by kind — a `<tempo>`
 * until the next tempo, an ornament only on its own notes — mapped back through the fit's
 * report of who wrote what. `callForElement` is the only thing that knows that mapping.
 *
 * A preview scoped to particular instructions — a narrative chip, a word in the viewer — is
 * left alone: the reader asked for those and is looking at them already.
 */
export const FollowPlayback = ({ mpm, beatDenominator }: FollowPlaybackProps) => {
    const { subscribeNoteEvents } = usePlayback();
    const { setActiveCallIds, callForElement } = useCallSelection();
    const { scrollToDate } = useScrollSync();

    const follow = useEffectEvent(({ date, scoped }: PlaybackNoteEvent) => {
        if (scoped) return;
        const sounding = new Set<string>();
        for (const type of instructionTypes) {
            const effective = instructionsEffectiveAtDate(mpm, date, type, undefined, beatDenominator);
            for (const instruction of effective) {
                if (instruction.id === undefined) continue;
                const owner = callForElement(instruction.id);
                if (owner !== undefined) sounding.add(owner);
            }
        }
        // A moment nothing claims leaves the last selection standing rather than clearing it:
        // the desk is still showing the last thing that sounded.
        if (sounding.size > 0) {
            setActiveCallIds((prev) => (setsEqual(prev, sounding) ? prev : sounding));
        }
        scrollToDate(date);
    });

    useEffect(() => subscribeNoteEvents(follow), [subscribeNoteEvents]);

    return null;
};
