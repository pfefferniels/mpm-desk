import { useEffect } from 'react';
import { useCallSelection } from '../hooks/CallSelection';
import { usePlayback } from '../hooks/PlaybackProvider';
import { callAddress } from '../model/callAddress';

/**
 * The viewer's URL, kept naming the call that is selected.
 *
 * So that what is on screen can be cited by copying the address: `#<address>` opens the viewer
 * at the desk that made the call, with the call selected and what it was fitted to marked, and
 * `https://welte225.org/mpm/<address>` is sent on to exactly that. With no call, or several,
 * selected, the hash is cleared rather than left naming one that is not.
 *
 * `replaceState`, not `pushState`: a click on a curve is not a place to go back to. And left alone
 * while the piece plays, since following the playhead selects whatever is sounding and the URL
 * would change with every note.
 *
 * The viewer's only: the editor names a call in the URL where it is taken to one
 * (`focusCall`), and leaves the address alone while it is being worked in.
 */
export const ViewerAddress = () => {
    const { activeCallIds, calls } = useCallSelection();
    const { isPlaying } = usePlayback();

    useEffect(() => {
        if (isPlaying) return;
        const [only] = activeCallIds;
        const hash =
            activeCallIds.size === 1 && only !== undefined
                ? '#' + callAddress(only, calls.map((call) => call.id))
                : '';
        if (window.location.hash === hash) return;
        window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search + hash,
        );
    }, [activeCallIds, calls, isPlaying]);

    return null;
};
