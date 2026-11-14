/**
 * The recording's transport, before there are samples.
 *
 * The piano sends for its samples only once something asks to be heard, and this button is one of
 * the ways to ask. It used to wait for the samples before it would take a press at all, which
 * would now be a wait for ever. A press it takes while they load waits for them in turn, and
 * starts by itself once they are here; pressing again meanwhile cancels it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { PianoProvider } from '../../performance/PianoProvider';
import type { PlayableNote } from '../../performance/buildMidiFile';
import { PlaybackBar } from './PlaybackBar';
import { useRecordingPlayback } from './useRecordingPlayback';

let status: 'loading' | 'done' = 'loading';
const statusListeners = new Set<() => void>();
/** The download finishing, as the library's provider reports it. */
const samplesArrive = () =>
    act(() => {
        status = 'done';
        statusListeners.forEach((listener) => listener());
    });

const play = vi.fn(() => ({}));

vi.mock('react-pianosound', () => ({
    PianoContextProvider: ({ children }: { children: ReactNode }) => children,
    usePiano: () => ({
        status: useSyncExternalStore(
            (listener) => {
                statusListeners.add(listener);
                return () => {
                    statusListeners.delete(listener);
                };
            },
            () => status,
        ),
        play,
        stop: vi.fn(),
    }),
}));

const notes: PlayableNote[] = [
    { id: 'a', pitch: 60, onsetMs: 0, offsetMs: 500, velocity: 64 },
    { id: 'b', pitch: 64, onsetMs: 500, offsetMs: 1500, velocity: 64 },
];

const Bar = () => <PlaybackBar playback={useRecordingPlayback({ notes })} />;

const mount = () =>
    render(
        <PianoProvider>
            <Bar />
        </PianoProvider>,
    );

const button = () => screen.getByRole('button');

beforeEach(() => {
    status = 'loading';
    play.mockClear();
});

describe('the recording transport', () => {
    it('takes a press before the samples are there, and starts it once they are', () => {
        mount();
        expect(button()).toBeEnabled();
        expect(button()).toHaveAttribute('title', 'Play 0:00 to 0:02');

        fireEvent.click(button());

        expect(play).not.toHaveBeenCalled();
        expect(button()).toBeEnabled();
        expect(button()).toHaveAttribute('title', expect.stringMatching(/Loading piano samples.*then playing/));

        samplesArrive();

        expect(play).toHaveBeenCalledTimes(1);
        expect(button()).toHaveAttribute('title', 'Stop');
    });

    it('cancels the waiting press when pressed again', () => {
        mount();
        fireEvent.click(button());
        fireEvent.click(button());

        samplesArrive();

        expect(play).not.toHaveBeenCalled();
        expect(button()).toHaveAttribute('title', 'Play 0:00 to 0:02');
    });
});
