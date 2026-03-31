import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { usePiano } from 'react-pianosound';
import { read, MidiFile } from 'midifile-ts';
import { MPM, MSM } from 'mpmify';
import { exportMPM } from '../../../mpm-ts/lib';
import { performMpm, PerformRequest } from '../utils/backendApi';
import { useZoom } from './ZoomProvider';
import { useLatest } from './useLatest';

export const EXAGGERATION_MAX = 2.0;

const SKETCH_THRESHOLD = 10;
const SKETCH_MAX = 1.5;

function computeSketchiness(stretchX: number): number {
    if (stretchX >= SKETCH_THRESHOLD) return 1.0;
    const t = (SKETCH_THRESHOLD - stretchX) / SKETCH_THRESHOLD;
    return 1 + (SKETCH_MAX - 1) * t * t;
}

function findNoteIdTime(file: MidiFile, noteId: string): number | null {
    for (const track of file.tracks) {
        let abs = 0;
        for (const event of track) {
            abs += event.deltaTime;
            if (event.type === 'meta' && event.subtype === 'text' && event.text === noteId) {
                return abs; // ticks = milliseconds in meico output
            }
        }
    }
    return null;
}

function decodeMidiBase64(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

interface PlayOptions {
    mpmIds?: string[];
    isolate?: boolean;
    exaggerate?: number;
    onNoteEvent?: (noteId: string, date: number) => void;
}

interface PlaybackContextValue {
    isPlaying: boolean;
    play: (options?: PlayOptions) => Promise<void>;
    stop: () => void;
    exaggeration: number;
    setExaggeration: (value: number) => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

interface PlaybackProviderProps {
    mei: string | undefined;
    msm: MSM;
    mpm: MPM;
    children: ReactNode;
}

export const PlaybackProvider = ({ mei, msm, mpm, children }: PlaybackProviderProps) => {
    const { play: playPiano, stop: stopPiano, jumpTo } = usePiano();
    const { stretchX } = useZoom();
    const [isPlaying, setIsPlaying] = useState(false);
    const [exaggeration, setExaggeration] = useState(1.0);

    // Store props and unstable usePiano() references in refs
    // so downstream callbacks and context value stay stable.
    const meiRef = useLatest(mei);
    const msmRef = useLatest(msm);
    const mpmRef = useLatest(mpm);
    const playPianoRef = useLatest(playPiano);
    const stopPianoRef = useLatest(stopPiano);
    const jumpToRef = useLatest(jumpTo);

    // Track playback state for mid-playback re-rendering
    const lastNoteIdRef = useRef<string | null>(null);
    const playOptionsRef = useRef<PlayOptions | undefined>(undefined);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isPlayingRef = useRef(false);

    const stop = useCallback(() => {
        stopPianoRef.current();
        setIsPlaying(false);
        isPlayingRef.current = false;
        lastNoteIdRef.current = null;
        playOptionsRef.current = undefined;
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
    }, [stopPianoRef]);

    const stretchXRef = useLatest(stretchX);

    const startPlayback = useCallback(async (options: PlayOptions | undefined, resumeFromNoteId: string | null) => {
        const currentMei = meiRef.current;
        const currentMsm = msmRef.current;
        const currentMpm = mpmRef.current;

        if (!currentMpm || !currentMei) return;

        const { mpmIds, isolate, exaggerate, onNoteEvent } = options || {};

        const request: PerformRequest = {
            mpm: exportMPM(currentMpm),
            mei: currentMei,
            sketchiness: computeSketchiness(stretchXRef.current),
        };

        if (exaggerate !== undefined) {
            request.exaggerate = exaggerate;
        }

        if (mpmIds) {
            request.mpmIds = mpmIds;
            if (request.exaggerate === undefined) request.exaggerate = 1.2;
            request.exemplify = false;
            request.context = 0;
            request.isolate = isolate;
        }

        try {
            const b64 = await performMpm(request);
            const midiBuffer = decodeMidiBase64(b64);
            const file = read(midiBuffer);

            // Find resume position if we're re-rendering mid-playback
            let resumeMs: number | null = null;
            if (resumeFromNoteId) {
                resumeMs = findNoteIdTime(file, resumeFromNoteId);
            }

            playPianoRef.current(file, (e) => {
                if (e.type === 'meta' && e.subtype === 'text') {
                    lastNoteIdRef.current = e.text;
                    if (onNoteEvent) {
                        const date = currentMsm.getByID(e.text)?.date;
                        if (date !== undefined) {
                            onNoteEvent(e.text, date);
                        }
                    }
                }
            });

            if (resumeMs !== null) {
                jumpToRef.current(resumeMs / 1000);
            }

            setIsPlaying(true);
            isPlayingRef.current = true;
        } catch (error) {
            console.error('Playback error:', error);
        }
    }, [meiRef, msmRef, mpmRef, stretchXRef, playPianoRef, jumpToRef]);

    const play = useCallback(async (options?: PlayOptions) => {
        stopPianoRef.current();
        lastNoteIdRef.current = null;
        playOptionsRef.current = options;
        await startPlayback(options, null);
    }, [stopPianoRef, startPlayback]);

    // Re-render on zoom change during playback (debounced)
    const prevStretchXRef = useRef(stretchX);
    useEffect(() => {
        const prev = prevStretchXRef.current;
        prevStretchXRef.current = stretchX;

        if (!isPlayingRef.current) return;
        // Skip if sketchiness didn't actually change
        if (computeSketchiness(prev) === computeSketchiness(stretchX)) return;

        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            if (!isPlayingRef.current) return;
            const noteId = lastNoteIdRef.current;
            stopPianoRef.current();
            startPlayback(playOptionsRef.current, noteId);
        }, 300);
    }, [stretchX, startPlayback, stopPianoRef]);

    const value = useMemo(() => ({
        isPlaying,
        play,
        stop,
        exaggeration,
        setExaggeration,
    }), [isPlaying, play, stop, exaggeration]);

    return (
        <PlaybackContext value={value}>
            {children}
        </PlaybackContext>
    );
};

export const usePlayback = (): PlaybackContextValue => {
    const context = useContext(PlaybackContext);
    if (!context) {
        throw new Error('usePlayback must be used within a PlaybackProvider');
    }
    return context;
};
