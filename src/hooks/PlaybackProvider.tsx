import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { usePiano } from '../performance/piano';
import type { AnyEvent } from 'midifile-ts';
import { renderCached, type RenderRequest, type Rendered } from '../utils/espressivo';
import { UNIDENTIFIED_NOTE, pickAnchor, renderedRange } from '../utils/anchor';
import { useZoom } from './ZoomProvider';
import { useLatest } from './useLatest';

const SKETCH_THRESHOLD = 10;
const SKETCH_MAX = 1.5;

/**
 * Minimum spacing between mid-playback updates, shared by the zoom and exaggeration knobs.
 *
 * Leading edge, so the first nudge of a drag is audible at once — debouncing on the trailing edge
 * alone gives a continuous drag no audio change at all until the finger stops. Trailing edge too,
 * so the value the drag ends on always lands.
 *
 * Notes attack roughly every 330 ms in this piece, and an update can only manifest at an attack,
 * so ten a second is already more than the music can express.
 */
const MIN_UPDATE_INTERVAL_MS = 100;

/** How far a slow machine is allowed to stretch that interval, as a multiple of its own cost. */
const BACKOFF_FACTOR = 3;

/**
 * How far ahead of the dispatch frontier an anchor must sit.
 *
 * Only a hair is needed: `getTransportSeconds()` already reports `currentTime + lookAhead`, so
 * anything past it provably has not been dispatched. The real spacing between updates comes from
 * note density, not from this number.
 */
const ANCHOR_LEAD_S = 0.02;

/**
 * How long playback is left running past the last note it covers.
 *
 * A preview's range ends at the following note's onset, which is where the gesture's last note
 * stops being the one you are listening to — but it is still ringing, and stopping the transport
 * damps it. A little tail lets it decay instead of being cut off mid-sound, and does the same for
 * the piece's final chord.
 */
const TAIL_MS = 900;

function computeSketchiness(stretchX: number): number {
    if (stretchX >= SKETCH_THRESHOLD) return 1.0;
    const t = (SKETCH_THRESHOLD - stretchX) / SKETCH_THRESHOLD;
    return 1 + (SKETCH_MAX - 1) * t * t;
}

/**
 * When what is playing is over, in the rendering's own milliseconds: the end of the preview's
 * range, or else the last event in the piece. `events` is sorted by `abs`.
 */
const endOfPlayback = (rendered: Rendered, heard: { toMs: number } | null): number | undefined =>
    heard ? heard.toMs : rendered.events.at(-1)?.abs;

interface PlayOptions {
    mpmIds?: string[];
    isolate?: boolean;
    exaggerate?: number;
    /**
     * Symbolic tick range to play, instead of the whole piece — a preview of one gesture.
     * Playback starts at the first note inside it and stops once it is through.
     */
    range?: { from: number; to: number };
}

export interface PlaybackNoteEvent {
    noteId: string;
    /** Symbolic date (ticks) of the sounding note. */
    date: number;
    /** True when playback is scoped to specific instructions (mpmIds), e.g. a segment preview. */
    scoped: boolean;
}

type NoteEventListener = (event: PlaybackNoteEvent) => void;

interface PlaybackContextValue {
    isPlaying: boolean;
    play: (options?: PlayOptions) => void;
    stop: () => void;
    exaggeration: number;
    setExaggeration: (value: number) => void;
    /**
     * Hear every note as it sounds — how anything follows the playhead. Returns the unsubscribe.
     *
     * A subscription rather than an option on `play()`: who plays and who follows are different
     * questions, and the same run may be followed by the tree, a desk, or nothing at all.
     */
    subscribeNoteEvents: (listener: NoteEventListener) => () => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

interface PlaybackProviderProps {
    /** The score as MSM XML, i.e. `public/score.msm`. */
    scoreMsm: string;
    /** The performance as MPM XML, i.e. `public/performance.mpm`. */
    performanceMpm: string;
    /** Note `xml:id` ⇒ symbolic date, for reporting where the playhead is. */
    dateByNoteId: Map<string, number>;
    children: ReactNode;
}

export const PlaybackProvider = ({ scoreMsm, performanceMpm, dateByNoteId, children }: PlaybackProviderProps) => {
    const piano = usePiano();
    const { stretchX } = useZoom();
    const [isPlaying, setIsPlaying] = useState(false);
    const [exaggeration, setExaggeration] = useState(1.0);

    // Store props and the unstable usePiano() references in refs so downstream callbacks and the
    // context value stay stable.
    const scoreMsmRef = useLatest(scoreMsm);
    const performanceMpmRef = useLatest(performanceMpm);
    const dateByNoteIdRef = useLatest(dateByNoteId);
    const stretchXRef = useLatest(stretchX);
    const pianoRef = useLatest(piano);

    // Track playback state for mid-playback updates
    const lastNoteIdRef = useRef<string | null>(null);
    const playOptionsRef = useRef<PlayOptions | undefined>(undefined);
    const isPlayingRef = useRef(false);

    // Throttle bookkeeping
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastUpdateRef = useRef(0);
    const intervalRef = useRef(MIN_UPDATE_INTERVAL_MS);

    const noteEventListenersRef = useRef(new Set<NoteEventListener>());
    const subscribeNoteEvents = useCallback((listener: NoteEventListener) => {
        noteEventListenersRef.current.add(listener);
        return () => {
            noteEventListenersRef.current.delete(listener);
        };
    }, []);

    const stop = useCallback(() => {
        pianoRef.current.stop();
        setIsPlaying(false);
        isPlayingRef.current = false;
        lastNoteIdRef.current = null;
        playOptionsRef.current = undefined;
        if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
        }
        if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
        }
    }, [pianoRef]);

    /**
     * The one note listener, shared by the initial play and every later splice — a spliced-in
     * schedule has to keep reporting where the playhead is, and keep the resume anchor current.
     */
    const noteListener = useCallback((event: AnyEvent) => {
        if (event.type !== 'meta' || event.subtype !== 'text') return;
        // Only identified notes are anchors; `'unknown'` would resolve to nothing and,
        // on the fallback path, restart the piece from bar 1.
        if (event.text !== UNIDENTIFIED_NOTE) lastNoteIdRef.current = event.text;

        if (noteEventListenersRef.current.size === 0) return;
        const date = dateByNoteIdRef.current.get(event.text);
        if (date === undefined) return;
        const scoped = playOptionsRef.current?.mpmIds !== undefined;
        noteEventListenersRef.current.forEach(listener => listener({ noteId: event.text, date, scoped }));
    }, [dateByNoteIdRef]);

    const buildRequest = useCallback((options: PlayOptions | undefined): RenderRequest => {
        const { mpmIds, isolate, exaggerate } = options || {};
        const request: RenderRequest = {
            msm: scoreMsmRef.current,
            mpm: performanceMpmRef.current,
            sketchiness: computeSketchiness(stretchXRef.current),
        };
        if (exaggerate !== undefined) request.exaggerate = exaggerate;
        if (mpmIds) {
            request.mpmIds = mpmIds;
            if (request.exaggerate === undefined) request.exaggerate = 1.2;
            request.isolate = isolate;
        }
        return request;
    }, [scoreMsmRef, performanceMpmRef, stretchXRef]);

    /** Where a preview's tick range falls in this particular rendering, if it names one. */
    const previewRange = useCallback((options: PlayOptions | undefined, rendered: Rendered) => {
        const range = options?.range;
        if (!range) return null;
        return renderedRange(rendered.noteIds, dateByNoteIdRef.current, range.from, range.to);
    }, [dateByNoteIdRef]);

    /**
     * Stop once what is playing has been heard through.
     *
     * The transport runs on past the last event of its own accord, so this is the only thing that
     * puts `isPlaying` back when nobody presses stop — otherwise the button sits on Stop over
     * silence.
     *
     * Re-armed against every rendering that gets installed, never carried over: the exaggeration
     * knob rescales time under a running piece, so how long is left is a property of the rendering
     * that is playing rather than of the click that started it.
     */
    const armStop = useCallback((endMs: number | undefined) => {
        if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
        }
        if (endMs === undefined) return;
        const { offset } = pianoRef.current.getSchedule() ?? { offset: 0 };
        const left = endMs + offset * 1000 - pianoRef.current.getTransportSeconds() * 1000;
        stopTimerRef.current = setTimeout(() => {
            stopTimerRef.current = null;
            stop();
        }, Math.max(0, left + TAIL_MS));
    }, [pianoRef, stop]);

    /**
     * Install a rendering from the top, discarding whatever was scheduled.
     *
     * With `resume`, the piece picks up where the last heard note sits in the *new* rendering —
     * which is somewhere else entirely, since exaggeration stretches the piece by up to a fifth.
     * The transport still restarts, so there is a short hole in the rhythm, but nothing is damped:
     * no `stopAll()` is called on the way through, so the sounding notes ring on. Re-striking the
     * note it lands on is a no-op while that note is still held.
     *
     * Without one, a `range` preview seeks to the head of its range instead of playing from bar 1.
     */
    const startPlayback = useCallback((options: PlayOptions | undefined, resume: Rendered | null) => {
        try {
            const rendered = resume ?? renderCached(buildRequest(options));
            const noteId = resume ? lastNoteIdRef.current : null;
            if (!pianoRef.current.play(rendered.file, noteListener)) return;
            const heard = previewRange(options, rendered);
            const startMs = noteId === null ? heard?.fromMs : rendered.noteIds.get(noteId);
            if (startMs !== undefined) pianoRef.current.jumpTo(startMs / 1000);
            setIsPlaying(true);
            isPlayingRef.current = true;
            armStop(endOfPlayback(rendered, heard));
        } catch (error) {
            console.error('Playback error:', error);
        }
    }, [armStop, buildRequest, noteListener, pianoRef, previewRange]);

    const play = useCallback((options?: PlayOptions) => {
        lastNoteIdRef.current = null;
        playOptionsRef.current = options;
        lastUpdateRef.current = Date.now();
        startPlayback(options, null);
    }, [startPlayback]);

    /**
     * Swap in a rendering at the new knob position without stopping the transport.
     *
     * The transport never stops: the two renderings are glued at the next note onset, so nothing
     * before the seam is disturbed and nothing is struck twice. Stopping the piano to re-render
     * and seek back in would damp every sounding note and every bit of pedal resonance and then
     * re-strike the note it landed on, which makes moving the knob sound like an event rather
     * than like a value moving.
     */
    const applyUpdate = useCallback(() => {
        lastUpdateRef.current = Date.now();
        if (!isPlayingRef.current) return;

        const startedAt = performance.now();
        const options = playOptionsRef.current;

        let rendered: Rendered;
        try {
            rendered = renderCached(buildRequest(options));
        } catch (error) {
            console.error('Playback error:', error);
            return;
        }

        const { splice, canSplice, getSchedule, getTransportSeconds } = pianoRef.current;
        const schedule = getSchedule();
        if (canSplice && schedule) {
            const notBefore = Math.max(getTransportSeconds() + ANCHOR_LEAD_S, schedule.from);
            const anchor = pickAnchor(schedule, rendered.noteIds, notBefore);
            // Past the last note the two renderings share, there is nothing to glue: let the
            // current one play out rather than reaching for a restart at the very end.
            if (!anchor) return;

            const result = splice({ events: rendered.events, anchor, cb: noteListener });
            if (result.ok) {
                // The seam rescales what is left, so the remaining time is re-read here.
                armStop(endOfPlayback(rendered, previewRange(options, rendered)));
                intervalRef.current = Math.max(
                    MIN_UPDATE_INTERVAL_MS,
                    (performance.now() - startedAt) * BACKOFF_FACTOR,
                );
                return;
            }
            // The playhead outran the anchor, or the anchor went backwards: nothing was cancelled,
            // so simply try again on the next tick with a fresh one.
            if (result.reason === 'stale' || result.reason === 'backwards') return;
        }

        // No seamless path (hardware output, or samples still loading): restart and seek back in,
        // without a `stopAll()` on the way, which would damp everything sounding.
        startPlayback(options, rendered);
    }, [armStop, buildRequest, noteListener, pianoRef, previewRange, startPlayback]);

    const scheduleUpdate = useCallback(() => {
        if (!isPlayingRef.current) return;
        const wait = lastUpdateRef.current + intervalRef.current - Date.now();
        if (wait <= 0) {
            applyUpdate();
            return;
        }
        // A trailing call is already armed; it reads the refs at fire time, so it picks up
        // whatever the drag has reached by then.
        if (throttleTimerRef.current) return;
        throttleTimerRef.current = setTimeout(() => {
            throttleTimerRef.current = null;
            applyUpdate();
        }, wait);
    }, [applyUpdate]);

    // Re-render on zoom change during playback
    const prevStretchXRef = useRef(stretchX);
    useEffect(() => {
        const prev = prevStretchXRef.current;
        prevStretchXRef.current = stretchX;

        if (!isPlayingRef.current) return;
        // Skip if sketchiness didn't actually change
        if (computeSketchiness(prev) === computeSketchiness(stretchX)) return;
        scheduleUpdate();
    }, [stretchX, scheduleUpdate]);

    // Re-render on exaggeration change during playback
    const prevExaggerationRef = useRef(exaggeration);
    useEffect(() => {
        const prev = prevExaggerationRef.current;
        prevExaggerationRef.current = exaggeration;

        if (!isPlayingRef.current || prev === exaggeration) return;
        // Carry the new value into the next rendering; scoping (mpmIds/isolate) stays as-is.
        playOptionsRef.current = { ...playOptionsRef.current, exaggerate: exaggeration };
        scheduleUpdate();
    }, [exaggeration, scheduleUpdate]);

    const value = useMemo(() => ({
        isPlaying,
        play,
        stop,
        exaggeration,
        setExaggeration,
        subscribeNoteEvents,
    }), [isPlaying, play, stop, exaggeration, subscribeNoteEvents]);

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
