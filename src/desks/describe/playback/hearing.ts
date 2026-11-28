/**
 * What the piano is handed for a hearing: the notes to strike and the sustaining pedal's presses,
 * in ms of the recording.
 *
 * The Desk's piano has a pedal, so a note is handed over with the end it has and the pedal beside
 * it. The prototype's piano had none, and held every note until its pedal came up.
 */
import type { Roll, Sounded } from '../../../fitting/description/client';
import type { PlayableNote, PlayablePedal } from '../../../performance/buildMidiFile';
import type { Hearing } from './types';

export interface Heard {
    notes: PlayableNote[];
    pedals: PlayablePedal[];
}

/** How long a grace note is sounded: the recording has its onset only. */
const GRACE_MS = 160;

/** A sounding as the piano strikes it, at `gain` of its loudness. */
export const keyOf = (
    id: string,
    pitch: number,
    { ms, msEnd, velocity }: Sounded,
    gain = 1,
): PlayableNote => ({
    id,
    pitch,
    onsetMs: ms,
    offsetMs: msEnd,
    velocity: Math.min(127, Math.max(1, Math.round(velocity * gain))),
});

/**
 * Keys in the order they are struck. A pitch struck again ends the note before on it, pedal or no
 * pedal: the piano passes over a key that is still down, and the second note would not sound.
 */
export const struck = (keys: readonly PlayableNote[]): PlayableNote[] => {
    const ordered = keys.map((key) => ({ ...key })).sort((a, b) => a.onsetMs - b.onsetMs);
    const last = new Map<number, PlayableNote>();
    for (const key of ordered) {
        const before = last.get(key.pitch);
        if (before && before.offsetMs > key.onsetMs) before.offsetMs = key.onsetMs;
        last.set(key.pitch, key);
    }
    return ordered;
};

/**
 * The presses of the sustaining pedal, from its moves in time order: down from the first move
 * past half-way to the next that is not, or to `end`.
 */
export const pressesOf = (
    moves: readonly { ms: number; value: number }[],
    end: number,
): PlayablePedal[] => {
    const presses: PlayablePedal[] = [];
    let down: number | null = null;
    for (const { ms, value } of [...moves, { ms: end, value: 0 }]) {
        if (value >= 64 && down === null) down = ms;
        else if (value < 64 && down !== null) {
            presses.push({ type: 'sustain', onsetMs: down, durationMs: Math.max(0, ms - down) });
            down = null;
        }
    }
    return presses;
};

/** The last moment the roll reaches, in ms. */
export const endOf = ({ notes, beats }: Pick<Roll, 'notes' | 'beats'>): number =>
    notes.reduce((end, note) => Math.max(end, note.msEnd, note.mpm.msEnd), beats.at(-1)?.ms ?? 0);

/** The sustaining pedal as it was recorded, or as the MPM renders it. */
export const pedalled = (roll: Roll, hearing: Hearing): PlayablePedal[] =>
    hearing === 'played'
        ? roll.pedals.played
              .filter((press) => press.kind === 'sustain')
              .map(({ ms, msEnd }) => ({ type: 'sustain', onsetMs: ms, durationMs: msEnd - ms }))
        : pressesOf(
              roll.pedals.mpm.filter((move) => move.kind === 'sustain'),
              endOf(roll),
          );

/** The whole piece in a hearing. Grace notes are in the recording only. */
export const heardOf = (roll: Roll, hearing: Hearing): Heard => ({
    notes: struck(
        hearing === 'played'
            ? [
                  ...roll.notes.map((note) => keyOf(note.id, note.pitch, note)),
                  ...roll.graces.map(({ id, pitch, ms, velocity }) =>
                      keyOf(id, pitch, { ms, msEnd: ms + GRACE_MS, velocity }),
                  ),
              ]
            : roll.notes.map((note) => keyOf(note.id, note.pitch, note.mpm)),
    ),
    pedals: pedalled(roll, hearing),
});
