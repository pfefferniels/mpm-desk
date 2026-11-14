import { useEffect } from 'react';
import type { Scope } from '../fitting/instructions/index';
import { useCallSelection } from '../hooks/CallSelection';
import { usePlayback } from '../hooks/PlaybackProvider';

/**
 * What a history entry takes the reader back to: the desk that was open, the scope on the picker
 * and the calls selected.
 *
 * The hash alone cannot say it. It names one call at most, so it says nothing of the desk a call
 * was reached from, and nothing at all where no call was selected.
 */
export interface View {
    /** The desk, by the key the registry selects it under. */
    desk: string;
    scope: Scope;
    /** The ids of the calls selected. */
    calls: readonly string[];
}

/**
 * Keeps the history entry the reader is on holding the view on screen, so that Back and Forward
 * can return to it. `App` restores a {@link View} on `popstate`.
 *
 * Kept current rather than written as an entry is left: an entry is left by Back as often as by a
 * push, and Back gives no chance to write into the entry it leaves. `replaceState` with no URL, so
 * the address stays with whoever keeps it (`ViewerAddress`, `focusCall`).
 *
 * Not while the piece plays, as `ViewerAddress` does not: following the playhead selects whatever
 * is sounding, and a browser throttles a page that replaces its state at that rate. The view
 * playback leaves behind is written when it stops.
 *
 * In both modes, since `focusCall` pushes an entry in both.
 */
export const ViewHistory = ({ desk, scope }: { desk: string; scope: Scope }) => {
    const { activeCallIds } = useCallSelection();
    const { isPlaying } = usePlayback();

    useEffect(() => {
        if (isPlaying) return;
        const view: View = { desk, scope, calls: [...activeCallIds] };
        window.history.replaceState(view, '');
    }, [desk, scope, activeCallIds, isPlaying]);

    return null;
};
