/**
 * The recording's transport, before there are samples.
 *
 * The piano sends for its samples only once something asks to be heard, and this button is one of
 * the ways to ask. It used to wait for the samples before it would take a press, which would now
 * be a wait for ever; and a press it takes and the piano refuses must not leave it on Stop.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PianoProvider } from '../../performance/PianoProvider';
import type { PlayableNote } from '../../performance/buildMidiFile';
import { PlaybackBar } from './PlaybackBar';
import { useRecordingPlayback } from './useRecordingPlayback';

const play = vi.fn(() => ({}));

/** A piano whose samples are there the moment it is mounted. */
vi.mock('react-pianosound', () => ({
    PianoContextProvider: ({ children }: { children: ReactNode }) => children,
    usePiano: () => ({ status: 'done', play, stop: vi.fn() }),
}));

const notes: PlayableNote[] = [
    { id: 'a', pitch: 60, onsetMs: 0, offsetMs: 500, velocity: 64 },
    { id: 'b', pitch: 64, onsetMs: 500, offsetMs: 1500, velocity: 64 },
];

const Bar = () => <PlaybackBar playback={useRecordingPlayback({ notes })} />;

describe('the recording transport', () => {
    it('takes the first press, which sends for the samples, without going to Stop over silence', () => {
        render(
            <PianoProvider>
                <Bar />
            </PianoProvider>,
        );
        expect(screen.getByTitle('Play 0:00 to 0:02')).toBeEnabled();

        fireEvent.click(screen.getByTitle('Play 0:00 to 0:02'));

        // Refused, since the samples were only sent for by this press; here they come at once.
        expect(play).not.toHaveBeenCalled();
        expect(screen.queryByTitle('Stop')).toBeNull();

        fireEvent.click(screen.getByTitle('Play 0:00 to 0:02'));

        expect(play).toHaveBeenCalledTimes(1);
        expect(screen.getByTitle('Stop')).toBeInTheDocument();
    });
});
