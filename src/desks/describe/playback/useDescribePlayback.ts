import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePiano } from '../../../performance/piano';
import { createPlayer } from './player';
import type { DescribePlayback, PlaybackInput } from './types';

/**
 * Hearing the describe desk's roll; see `player.ts`, which does the playing.
 *
 * What is returned changes when what it shows does, and at no tick of the line. Its functions are
 * the same ones for as long as the desk is mounted.
 */
export const useDescribePlayback = (input: PlaybackInput): DescribePlayback => {
    const piano = usePiano();
    const [player] = useState(createPlayer);

    // After every render: `usePiano` hands back another object each time, and the run is told
    // from the last one by being another.
    useEffect(() => {
        player.update(input, piano);
    });
    useEffect(() => player.dispose, [player]);

    const shown = useSyncExternalStore(player.subscribe, player.shown);
    return useMemo(() => ({ ...shown, ...player.controls }), [shown, player]);
};
