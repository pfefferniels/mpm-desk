import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { usePiano } from 'react-pianosound';
import { read } from 'midifile-ts';
import { MPM, MSM } from 'mpmify';
import { exportMPM } from '../../../mpm-ts/lib';
import { performMpm, PerformRequest } from '../utils/backendApi';

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
    const { play: playPiano, stop: stopPiano } = usePiano();
    const [isPlaying, setIsPlaying] = useState(false);
    const [exaggeration, setExaggeration] = useState(1.0);

    // Store props in refs so play() callback stays stable
    const meiRef = useRef(mei);
    const msmRef = useRef(msm);
    const mpmRef = useRef(mpm);

    useEffect(() => {
        meiRef.current = mei;
    }, [mei]);

    useEffect(() => {
        msmRef.current = msm;
    }, [msm]);

    useEffect(() => {
        mpmRef.current = mpm;
    }, [mpm]);

    const stop = useCallback(() => {
        stopPiano();
        setIsPlaying(false);
    }, [stopPiano]);

    const play = useCallback(async (options?: PlayOptions) => {
        stopPiano();

        const currentMei = meiRef.current;
        const currentMsm = msmRef.current;
        const currentMpm = mpmRef.current;

        if (!currentMpm || !currentMei) return;

        const { mpmIds, isolate, exaggerate, onNoteEvent } = options || {};

        const request: PerformRequest = {
            mpm: exportMPM(currentMpm),
            mei: currentMei,
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

            // decode base64 to ArrayBuffer
            const binary = atob(b64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
            const midiBuffer = bytes.buffer;

            const file = read(midiBuffer);
            playPiano(file, (e) => {
                if (e.type === 'meta' && e.subtype === 'text' && onNoteEvent) {
                    const date = currentMsm.getByID(e.text)?.date;
                    if (date !== undefined) {
                        onNoteEvent(e.text, date);
                    }
                }
            });

            setIsPlaying(true);
        } catch (error) {
            console.error('Playback error:', error);
        }
    }, [playPiano, stopPiano]);

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
