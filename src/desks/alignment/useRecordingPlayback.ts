/**
 * Hearing the *recording*, or any stretch of it, while the score follows along.
 *
 * Not `hooks/PlaybackProvider`, which plays what the chain wrote: espressivo rendering an MSM
 * through an MPM, which does not exist until something has been fitted. This plays the MIDI file
 * itself, which is the only thing there is to hear while an alignment is being checked — and
 * checking one is exactly listening to whether the right notes light up.
 *
 * The stretch to play is chosen here and the piano is handed that stretch rebased to its own
 * start, because checking one bar by ear otherwise means sitting through everything before it,
 * which in practice means not checking it.
 *
 * What lights up is left to the caller: a played note may answer to a written note, to a cross
 * drawn where nothing was written, or to nothing on screen at all.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePiano, whenSamplesArrive, type Piano } from "../../performance/piano";
import type { AnyEvent } from "midifile-ts";
import {
    midiFileOf,
    type PlayableNote,
    type PlayablePedal,
} from "../../performance/buildMidiFile";

/** How long a note stays lit after it is struck */
const HIGHLIGHT_MS = 600;

/** The class a sounding note is lit with; the styles are per view */
const PLAYING_CLASS = "note-playing";

/** Silence allowed after the last note before the transport is called finished */
const TAIL_MS = 400;

interface PlaybackOptions {
    notes: readonly PlayableNote[];
    pedals?: readonly PlayablePedal[];
    /**
     * Where the note with this id is drawn: every place, when it is on screen more than once.
     * The first is the one the page is scrolled to. The default looks for the `data-id`
     * verovio gives every note it renders.
     */
    elementsFor?: (id: string) => readonly Element[];
}

export interface Playback {
    /** How long the whole performance runs, in milliseconds */
    durationMs: number;
    /** The stretch that pressing play would sound */
    range: [number, number];
    setRange: (range: [number, number]) => void;
    /** Whether the range still covers the whole performance */
    whole: boolean;
    playing: boolean;
    /**
     * A press was refused because the samples were still coming, and starts by itself once
     * they are here; `stop` cancels it
     */
    pending: boolean;
    play: () => void;
    /**
     * Sound one stretch of the performance and leave the range as it is: for hearing a single
     * place, which is a question about that place and not a change of what the transport plays.
     */
    playStretch: (fromMs: number, toMs: number) => void;
    stop: () => void;
    /**
     * Whether the piano is ready, still fetching its samples, or has failed. `undefined` until
     * something has asked for sound, which is when the samples are sent for.
     */
    status: "loading" | "done" | "error" | undefined;
}

/** A moment of a performance, as minutes and seconds */
export function clock(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const byDataId = (id: string) =>
    document.querySelector(
        `[data-id="${typeof CSS?.escape === "function" ? CSS.escape(id) : id}"]`
    );

function clearHighlights() {
    for (const element of document.querySelectorAll(`.${PLAYING_CLASS}`)) {
        element.classList.remove(PLAYING_CLASS);
    }
}

export function useRecordingPlayback({ notes, pedals, elementsFor }: PlaybackOptions): Playback {
    const piano = usePiano();
    const [playing, setPlaying] = useState(false);
    /**
     * The chosen stretch, and the performance it was chosen in. Loading another
     * one has to put the range back to the whole of it, and remembering what it
     * was chosen for says so without an effect that resets it afterwards.
     */
    const [chosen, setChosen] = useState<{ of: number; range: [number, number] }>();
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    /**
     * What cancels a press that is waiting for the samples. Stop, another press,
     * another performance and leaving the desk all go through `stop`, which calls it.
     */
    const pending = useRef<(() => void) | null>(null);
    const [waiting, setWaiting] = useState(false);
    // The latest `stop`, for the timer and the effect below, which call it later
    // than the render they were made in: `usePiano` hands back a new object on
    // every render, and an earlier render's `stop` holds a piano since replaced.
    const latest = useRef<() => void>(() => {});

    const durationMs = useMemo(
        () => notes.reduce((longest, note) => Math.max(longest, note.offsetMs), 0),
        [notes]
    );

    const range: [number, number] =
        chosen && chosen.of === durationMs ? chosen.range : [0, durationMs];

    const stop = () => {
        pending.current?.();
        pending.current = null;
        setWaiting(false);
        clearTimeout(timer.current);
        timer.current = undefined;
        piano.stop();
        setPlaying(false);
        clearHighlights();
    };

    /** Light the note a sounding event belongs to, wherever it is drawn */
    const light = (event: AnyEvent) => {
        if (event.type !== "meta" || event.subtype !== "text" || !("text" in event)) return;

        const id = (event as AnyEvent & { text: string }).text;
        const drawn = byDataId(id);
        const elements = elementsFor ? elementsFor(id) : drawn ? [drawn] : [];
        if (elements.length === 0) return;

        for (const element of elements) element.classList.add(PLAYING_CLASS);
        elements[0].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        setTimeout(() => {
            for (const element of elements) element.classList.remove(PLAYING_CLASS);
        }, HIGHLIGHT_MS);
    };

    const playStretch = (fromMs: number, toMs: number) => {
        const playable = notes.filter(
            (note) => note.onsetMs >= fromMs && note.onsetMs <= toMs
        );
        if (playable.length === 0) return;

        stop();
        const file = midiFileOf(playable, pedals, { fromMs, toMs });
        // The transport runs on after the last note, so the end of the sound is
        // worked out here rather than waited for - otherwise the button stays on
        // "Stop" for a performance that finished a minute ago
        const last = playable.reduce((end, note) => Math.max(end, note.offsetMs), fromMs);

        const start = (ready: Piano) => {
            if (!ready.play(file, light)) return false;
            setPlaying(true);
            timer.current = setTimeout(() => latest.current(), last - fromMs + TAIL_MS);
            return true;
        };
        if (start(piano)) return;

        // Refused while the samples are still coming, and the first press is what sends for
        // them. It starts by itself once they are here, rather than taking a second press,
        // unless `stop` has cancelled it by then
        const cancel = whenSamplesArrive((arrived) => {
            pending.current = null;
            setWaiting(false);
            start(arrived);
        });
        if (!cancel) return;
        pending.current = cancel;
        setWaiting(true);
    };

    const play = () => {
        playStretch(range[0], range[1]);
    };

    // Leaving the page, or loading another performance, has to silence this one,
    // and drop a press still waiting to start. Through `latest`, because an
    // effect keyed on `stop` would stop the sound as fast as it started.
    useEffect(() => {
        latest.current = stop;
    });
    useEffect(() => () => latest.current(), [durationMs]);

    return {
        durationMs,
        range,
        setRange: (range) => setChosen({ of: durationMs, range }),
        whole: range[0] === 0 && range[1] === durationMs,
        playing,
        pending: waiting,
        play,
        playStretch,
        stop,
        status: piano.status,
    };
}
