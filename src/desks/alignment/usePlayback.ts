/**
 * Hearing a performance, or any stretch of one, while the score follows along.
 *
 * Both views that show a performance want the same thing and used to have only
 * half of it: press play, hear the recording from the top, watch the notes light
 * up. Checking one bar of an alignment by ear meant sitting through everything
 * before it, which in practice meant not checking it at all. So the stretch to
 * play is chosen here, and the piano is handed exactly that stretch rebased to
 * its own start.
 *
 * What lights up is left to the caller. The Viewer plays notes the document
 * already holds, so a note's id is the id of the thing to light; the aligner
 * plays what was *performed*, where a note may answer to a written note, to a
 * cross drawn where nothing was written, or to nothing on screen at all.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePiano } from "react-pianosound";
import type { AnyEvent } from "midifile-ts";
import {
    midiFileOf,
    type PlayableNote,
    type PlayablePedal,
} from "../../performance/buildMidiFile";
import { useSampleProgress, type SampleProgress } from "./pianoLoading";

/** How long a note stays lit after it is struck */
const HIGHLIGHT_MS = 600;

/** The class a sounding note is lit with; the styles are per view */
const PLAYING_CLASS = "note-playing";

/** Silence allowed after the last note before the transport is called finished */
const TAIL_MS = 400;

export interface PlaybackOptions {
    notes: readonly PlayableNote[];
    pedals?: readonly PlayablePedal[];
    /**
     * Where the note with this id is drawn. The default looks for the `data-id`
     * verovio gives every note it renders.
     */
    elementFor?: (id: string) => Element | null | undefined;
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
    play: () => void;
    stop: () => void;
    /** Whether the piano is ready, still fetching its samples, or has failed */
    status: "loading" | "done" | "error" | undefined;
    samples: SampleProgress;
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

export function usePlayback({ notes, pedals, elementFor }: PlaybackOptions): Playback {
    const piano = usePiano();
    const [playing, setPlaying] = useState(false);
    /**
     * The chosen stretch, and the performance it was chosen in. Loading another
     * one has to put the range back to the whole of it, and remembering what it
     * was chosen for says so without an effect that resets it afterwards.
     */
    const [chosen, setChosen] = useState<{ of: number; range: [number, number] }>();
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const samples = useSampleProgress(piano.status === "loading");

    const durationMs = useMemo(
        () => notes.reduce((longest, note) => Math.max(longest, note.offsetMs), 0),
        [notes]
    );

    const range: [number, number] =
        chosen && chosen.of === durationMs ? chosen.range : [0, durationMs];

    const stop = () => {
        clearTimeout(timer.current);
        timer.current = undefined;
        piano.stop();
        setPlaying(false);
        clearHighlights();
    };

    const play = () => {
        const [fromMs, toMs] = range;
        const playable = notes.filter(
            (note) => note.onsetMs >= fromMs && note.onsetMs <= toMs
        );
        if (playable.length === 0) return;

        stop();
        setPlaying(true);
        piano.play(midiFileOf(playable, pedals, { fromMs, toMs }), (event: AnyEvent) => {
            if (event.type !== "meta" || event.subtype !== "text" || !("text" in event)) return;

            const id = (event as AnyEvent & { text: string }).text;
            const element = elementFor ? elementFor(id) : byDataId(id);
            if (!element) return;

            element.classList.add(PLAYING_CLASS);
            element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
            setTimeout(() => element.classList.remove(PLAYING_CLASS), HIGHLIGHT_MS);
        });

        // The transport runs on after the last note, so the end of the sound is
        // worked out here rather than waited for - otherwise the button stays on
        // "Stop" for a performance that finished a minute ago
        const last = playable.reduce((end, note) => Math.max(end, note.offsetMs), fromMs);
        timer.current = setTimeout(stop, last - fromMs + TAIL_MS);
    };

    // Leaving the page, or loading another performance, has to silence this one.
    // Held through a ref because `usePiano` hands back a new object on every
    // render, and an effect keyed on that would stop the sound as fast as it
    // started.
    const latest = useRef(stop);
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
        play,
        stop,
        status: piano.status,
        samples,
    };
}
