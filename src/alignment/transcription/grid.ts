/**
 * The metrical grid a played note is put onto, and how likely each place on it is.
 *
 * Positions are counted in twenty-fourths of a quarter note from the barline, which is the
 * coarsest unit that holds a thirty-second note (three of them) and a triplet sixteenth (four)
 * as whole numbers. Nothing finer is offered: below that a note is not measured, it is a grace.
 */

import { beatLength, isCompound, type MeasureModel, type Meter } from "./scoreModel";

/** Grid units in a quarter note. */
export const UNITS = 24;

/**
 * How deep in the beat a position lies: the number of equal parts the beat has to be cut into
 * before one of the cuts falls on it.
 *
 * 1 is the beat itself. In a simple metre 2, 4 and 8 are the binary divisions and 3, 6 and 12
 * the triplet ones; in a compound metre the beat is cut in three first, so 3, 6 and 12 are the
 * ordinary eighths, sixteenths and thirty-seconds and nothing else is offered. 0 is a position
 * off the grid altogether, which only a note the score already writes can stand on.
 */
export type Level = 0 | 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16 | 24 | 48;

const SIMPLE_LEVELS: Level[] = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48];
const COMPOUND_LEVELS: Level[] = [1, 3, 6, 12, 24, 48];

/** The level of a position, given how far it is from the barline in quarter notes. */
export function levelOf(fromBarline: number, meter: Meter): Level {
    const beat = beatLength(meter);
    const inBeat = ((fromBarline % beat) + beat) % beat / beat;
    for (const level of isCompound(meter) ? COMPOUND_LEVELS : SIMPLE_LEVELS) {
        const parts = inBeat * level;
        if (Math.abs(parts - Math.round(parts)) < 1e-6) return level;
    }
    return 0;
}

/** How many positions in one beat lie at exactly this level, which a level's mass is shared among. */
export function placesAt(level: Level, meter: Meter): number {
    if (level === 0) return 1;
    const chain = isCompound(meter) ? COMPOUND_LEVELS : SIMPLE_LEVELS;
    let covered = 0;
    // The positions a level adds are the ones no coarser level it contains already had
    const places = (candidate: Level): number => {
        let count = 0;
        for (let part = 0; part < candidate; part++) {
            const coarser = chain.some(
                (other) => other < candidate && Number.isInteger((part * other) / candidate),
            );
            if (!coarser) count++;
        }
        return count;
    };
    covered = places(level);
    return Math.max(1, covered);
}

/**
 * How often a written onset lies at each level, over the Chopin first editions of the corpus.
 *
 * Measured by `scripts/transcription/levels.ts`, and only the starting point: around any one
 * note the score's own neighbouring bars say far more, and {@link levelPrior} lets them.
 */
const GENERIC_SIMPLE: Partial<Record<Level, number>> = {
    1: 0.37,
    2: 0.26,
    4: 0.12,
    3: 0.08,
    8: 0.065,
    6: 0.005,
    12: 0.003,
    0: 0.096,
};

const GENERIC_COMPOUND: Partial<Record<Level, number>> = {
    1: 0.25,
    3: 0.41,
    6: 0.22,
    12: 0.025,
    0: 0.08,
};

/** How strongly the generic distribution is believed against what the bars around say. */
const GENERIC_WEIGHT = 6;

/** The least any level is given, so that nothing the grid offers is ever impossible. */
const FLOOR = 0.002;

/**
 * P(level) around one place in the score: what the neighbouring bars do, smoothed towards what
 * Chopin does in general.
 *
 * This is where knowing the score pays most. A blind transcriber has to guess whether a passage
 * moves in triplets; here the left hand has usually been playing them for eight bars.
 */
export function levelPrior(
    counts: ReadonlyMap<Level, number>,
    meter: Meter,
): (level: Level) => number {
    const generic = isCompound(meter) ? GENERIC_COMPOUND : GENERIC_SIMPLE;
    let total = 0;
    for (const count of counts.values()) total += count;

    return (level) => {
        const local = counts.get(level) ?? 0;
        const share = (local + GENERIC_WEIGHT * (generic[level] ?? 0)) / (total + GENERIC_WEIGHT);
        return Math.max(FLOOR, share);
    };
}

/** The grid positions of a measure strictly inside an interval, as offsets in quarter notes. */
export function gridPositions(
    measure: MeasureModel,
    from: number,
    to: number,
    /** The finest step worth offering, in quarter notes: finer is faster than fingers move */
    finest: number,
): number[] {
    const compound = isCompound(measure.meter);
    const positions: number[] = [];
    const length = Math.round(measure.duration * UNITS);

    for (let unit = 0; unit < length; unit++) {
        // Thirty-seconds are every third unit, triplet sixteenths every fourth, triplet
        // thirty-seconds every second. A compound metre has no use for the triplet ones
        const plain = unit % 3 === 0;
        const triplet = !compound && unit % 2 === 0;
        if (!plain && !triplet) continue;

        const step = unit % 12 === 0 ? 0.5 : unit % 6 === 0 ? 0.25 : plain ? 0.125 : unit % 8 === 0 ? 1 / 3 : unit % 4 === 0 ? 1 / 6 : 1 / 12;
        if (step < finest - 1e-9) continue;

        const onset = measure.onset + unit / UNITS;
        if (onset > from + 1e-9 && onset < to - 1e-9) positions.push(onset);
    }
    return positions;
}
