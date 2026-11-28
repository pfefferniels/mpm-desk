/**
 * The renderer's own performance of an MPM, as the roll and a bringing out read it.
 */
import { performMsmToData } from 'espressivo';

/** A note as it sounds: its onset and release in ms, and its velocity. */
export interface Sounded {
    ms: number;
    msEnd: number;
    velocity: number;
}

export type PedalKind = 'sustain' | 'soft';

interface Performance {
    notes: ({ id: string } & Sounded)[];
    /** Every move of a pedal, at its score date and its time; `value` is of 127. */
    pedals: { kind: PedalKind; date: number; ms: number; value: number }[];
}

/**
 * `work` with the console held still. The chain and the renderer warn of what a tolerant run
 * reports by itself, a step at a time.
 */
export const silently = <T>(work: () => T): T => {
    const { log, warn, error } = console;
    console.log = console.warn = console.error = () => undefined;
    try {
        return work();
    } finally {
        Object.assign(console, { log, warn, error });
    }
};

/** `mpm` as the renderer performs `score`, on the renderer's own clock. */
export const perform = (score: string, mpm: string): Performance =>
    silently(() => {
        const performance: Performance = { notes: [], pedals: [] };
        const data = performMsmToData({ msm: score, mpm }, { expandOrnaments: false, seed: 1 });
        for (const part of data.parts) {
            for (const note of part.notes) {
                if (note.id === null) continue;
                performance.notes.push({
                    id: note.id,
                    ms: note.milliseconds.date,
                    msEnd: note.milliseconds.end,
                    velocity: note.velocity,
                });
            }
            for (const stream of part.controlChanges) {
                const kind = stream.controller;
                if (kind !== 'sustain' && kind !== 'soft') continue;
                for (const point of stream.points) {
                    performance.pedals.push({
                        kind,
                        date: point.date,
                        ms: point.milliseconds,
                        value: point.value,
                    });
                }
            }
        }
        return performance;
    });
