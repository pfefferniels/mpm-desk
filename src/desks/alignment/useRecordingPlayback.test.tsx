/**
 * Hearing one place of the recording.
 *
 * The transport plays the range the reader has set. An alteration asks a narrower question —
 * how did *this* sound — and gets the stretch around it, without the transport's range being
 * moved to answer it. What sounds lights up wherever it is drawn, which while an alteration is
 * open is twice: on the page, and in the bar the reader is looking at.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AnyEvent, MidiFile } from 'midifile-ts';
import type { ReactNode } from 'react';
import { PianoProvider } from '../../performance/PianoProvider';
import type { PlayableNote } from '../../performance/buildMidiFile';
import { useRecordingPlayback, type Playback } from './useRecordingPlayback';

const play = vi.fn<(file: MidiFile, onEvent?: (event: AnyEvent) => void) => object>(() => ({}));

vi.mock('react-pianosound', () => ({
    PianoContextProvider: ({ children }: { children: ReactNode }) => children,
    usePiano: () => ({ status: 'done', play, stop: vi.fn() }),
}));

const notes: PlayableNote[] = [
    { id: 'a', pitch: 60, onsetMs: 0, offsetMs: 900, velocity: 64 },
    { id: 'b', pitch: 62, onsetMs: 1000, offsetMs: 1900, velocity: 64 },
    { id: 'c', pitch: 64, onsetMs: 2000, offsetMs: 2900, velocity: 64 },
    { id: 'd', pitch: 65, onsetMs: 3000, offsetMs: 3900, velocity: 64 },
];

const mount = (elementsFor?: (id: string) => readonly Element[]): { current: Playback } =>
    renderHook(() => useRecordingPlayback({ notes, elementsFor }), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <PianoProvider>{children}</PianoProvider>
        ),
    }).result;

/** The pitches a played file strikes, in order */
const struck = (file: MidiFile) =>
    file.tracks
        .flat()
        .flatMap((event) =>
            event.type === 'channel' && event.subtype === 'noteOn' ? [event.noteNumber] : [],
        );

beforeEach(() => {
    play.mockClear();
});

describe('hearing one stretch of the recording', () => {
    it('sounds what was struck in the stretch, and nothing before or after', () => {
        const playback = mount();
        act(() => {
            playback.current.playStretch(900, 2500);
        });

        expect(play).toHaveBeenCalledTimes(1);
        expect(struck(play.mock.calls[0][0])).toEqual([62, 64]);
        expect(playback.current.playing).toBe(true);
    });

    it('leaves the range of the transport where the reader set it', () => {
        const playback = mount();
        act(() => {
            playback.current.setRange([0, 1500]);
        });
        act(() => {
            playback.current.playStretch(1900, 3500);
        });

        expect(playback.current.range).toEqual([0, 1500]);
        expect(playback.current.whole).toBe(false);
    });

    it('sounds nothing where nothing was struck', () => {
        const playback = mount();
        act(() => {
            playback.current.playStretch(4000, 6000);
        });

        expect(play).not.toHaveBeenCalled();
        expect(playback.current.playing).toBe(false);
    });

    it('lights a sounding note in every place it is drawn', () => {
        const onPage = document.createElement('div');
        const inBar = document.createElement('div');
        onPage.scrollIntoView = vi.fn();
        inBar.scrollIntoView = vi.fn();
        const playback = mount((id) => (id === 'b' ? [onPage, inBar] : []));

        act(() => {
            playback.current.playStretch(900, 1500);
        });
        const onEvent = play.mock.calls[0][1];
        act(() => {
            onEvent?.({ type: 'meta', subtype: 'text', text: 'b', deltaTime: 0 } as AnyEvent);
        });

        expect(onPage).toHaveClass('note-playing');
        expect(inBar).toHaveClass('note-playing');
        // The page is brought to the note; the bar is already in front of the reader
        expect(onPage.scrollIntoView).toHaveBeenCalled();
        expect(inBar.scrollIntoView).not.toHaveBeenCalled();
    });
});
