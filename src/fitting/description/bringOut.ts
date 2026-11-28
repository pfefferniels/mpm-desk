/**
 * A run's rendering with the instructions of one remark brought out: their dimensions of the
 * performance exaggerated, every other one held back.
 *
 * The exaggeration is espressivo's, which works on whole dimensions (tempo, dynamics, rubato and
 * so on) rather than on single instructions.
 */
import { exaggerateMpm, spotlightMpm } from 'espressivo';
import { clamp } from '../utils';
import { perform, silently } from './perform';

/** An MPM with some of its instructions brought out, as the renderer performs it. */
export interface BroughtOut {
    /** Every note as performed, in ms on this rendering's own clock (not the recording's). */
    notes: { id: string; ms: number; msEnd: number; velocity: number }[];
    /** The sustaining pedal's moves each once, in time order; `value` is of 127. */
    pedal: { ms: number; value: number }[];
    /** The expression dimensions exaggerated; empty where nothing could be brought out. */
    spared: string[];
}

/** `mpm` with the dimensions of the instructions `ids` exaggerated and every other one damped. */
const emphasize = (mpm: string, ids: readonly string[], factor: number, attenuation: number) => {
    const plain = { mpm, spared: [] as string[] };
    const present = ids.filter((id) => mpm.includes(`xml:id="${id}"`));
    if (present.length === 0) return plain;
    try {
        const { mpm: damped, spared } = spotlightMpm(mpm, {
            ids: present,
            attenuation: clamp(attenuation, 0.05, 1),
        });
        // Beyond 1.9 an ornament can end a note before it begins. The shape of a transition is left
        // as it is: exaggerated, a late ritardando is squeezed into its last chord.
        const sized = spared.filter((dimension) => !dimension.endsWith('Shape'));
        const factors = Object.fromEntries(
            sized.map((dimension) => [dimension, clamp(factor, 1, 1.9)]),
        );
        return { mpm: exaggerateMpm(damped, { factors }).mpm, spared: [...spared] };
    } catch {
        // An id that governs no dimension, a definition or a style switch: nothing to bring out.
        return plain;
    }
};

/**
 * The rendering of a run with the instructions `ids` exaggerated by `factor` (1 to 1.9) and every
 * other dimension damped to `attenuation` (0.05 to 1). Ids the MPM does not hold are passed over.
 *
 * @param run the `mpm` and the `score` of the `DescriptionRun` the instructions belong to.
 */
export const bringOut = (
    run: { mpm: string; score: string },
    ids: readonly string[],
    factor: number,
    attenuation: number,
): BroughtOut => {
    const emphasized = silently(() => emphasize(run.mpm, ids, factor, attenuation));
    const { notes, pedals } = perform(run.score, emphasized.mpm);
    // The renderer states each move several times over, and in every part.
    const moves = new Map(
        pedals
            .filter((move) => move.kind === 'sustain')
            .map(({ ms, value }) => [`${ms} ${value}`, { ms, value }]),
    );
    return {
        notes,
        pedal: [...moves.values()].sort((a, b) => a.ms - b.ms),
        spared: emphasized.spared,
    };
};
