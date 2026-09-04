/**
 * What an instruction *does*, sampled over a stretch of the piece.
 *
 * A gesture drawn as a plain bar says when it happens and nothing about what it is: a
 * `<dynamics>` that swells and one that fades come out identical. These samplers read the shape
 * itself, at enough places across the card to draw.
 *
 * **The numbers are the renderer's**, as in `utils/mpm.ts`: `tempoAt`, `dynamicsAt` and
 * `positionAt` are espressivo's own evaluators, so a curve cannot disagree with what is heard.
 * Nothing is derived from `@transition.to`, `@curvature` or `@protraction` directly.
 *
 * One rule holds all three lanes together: **the value at a tick belongs to the last instruction
 * of that lane at or before it.** Past its own span an evaluator answers with the value it left
 * behind, which is the controller value still standing in the render, so a lane stays continuous
 * across a gap without anything here holding a value.
 */
import {
    controllerOf,
    dynamicsAt,
    positionAt,
    tempoAt,
    type Instruction,
    type PerformanceReader,
} from "../utils/mpm";

export interface CurvePoint {
    tick: number;
    value: number;
}

/**
 * How many places a lane is read at across the whole card.
 *
 * The card's track is a couple of hundred pixels wide, so this is about one reading every
 * two pixels — finer than the drawing can show, and cheap enough to redo on every hover.
 */
const SAMPLES = 120;

/** One instruction's stretch of a lane, and how to read it. */
interface Stretch {
    from: number;
    to: number;
    at: (tick: number) => number;
}

/**
 * Read a lane's stretches across `[from, to]` as one polyline.
 *
 * Each stretch is sampled over its own share of the window, endpoints exactly. Where two
 * stretches meet, the first ends and the second begins at the same tick, so a step between
 * two instructions comes out as the vertical jump it is rather than a ramp.
 */
function walk(stretches: Stretch[], from: number, to: number): CurvePoint[] {
    const window = to - from;
    if (!(window > 0)) return [];

    const points: CurvePoint[] = [];
    for (const stretch of stretches) {
        const start = Math.max(from, stretch.from);
        const end = Math.min(to, stretch.to);
        if (end < start) continue;

        const steps = Math.max(1, Math.round((SAMPLES * (end - start)) / window));
        for (let i = 0; i <= steps; i++) {
            const tick = start + ((end - start) * i) / steps;
            points.push({ tick, value: stretch.at(tick) });
        }
    }
    return points;
}

/**
 * The instructions of one lane that have anything to say inside `[from, to]`, paired with
 * where each one's say ends: the next of the same lane, or the end of the window.
 *
 * The one before the window is included and clipped, so a lane opens on the value that is
 * actually standing rather than on nothing.
 */
function stretchesOf<T>(
    lane: readonly Instruction[],
    from: number,
    to: number,
    resolve: (instruction: Instruction) => T | null,
    at: (record: T, tick: number) => number,
): Stretch[] {
    const stretches: Stretch[] = [];
    for (let i = 0; i < lane.length; i++) {
        const start = lane[i].date;
        const end = i + 1 < lane.length ? lane[i + 1].date : to;
        // Strictly overlapping, not merely touching: an instruction that hands over exactly
        // where the window opens would otherwise contribute a zero-width stretch at the
        // left edge, and the value it left behind would be read as the window's own.
        if (end <= from || start >= to) continue;
        const record = resolve(lane[i]);
        // A skipped instruction is not an extension of the previous one — it leaves a hole,
        // and the lane resumes at the next one that reads.
        if (record === null) continue;
        stretches.push({ from: start, to: end, at: tick => at(record, tick) });
    }
    return stretches;
}

/** The tempo across `[from, to]`, in bpm. */
export function tempoCurve(mpm: PerformanceReader, from: number, to: number): CurvePoint[] {
    return walk(stretchesOf(mpm.ofType('tempo'), from, to, mpm.tempoOf, tempoAt), from, to);
}

/** The dynamics across `[from, to]`, in MIDI velocity. */
export function dynamicsCurve(mpm: PerformanceReader, from: number, to: number): CurvePoint[] {
    return walk(stretchesOf(mpm.ofType('dynamics'), from, to, mpm.dynamicsOf, dynamicsAt), from, to);
}

/**
 * One controller's movement across `[from, to]`, in the normalized 0..1 position domain.
 *
 * Read one controller at a time because a `movementMap` interleaves them and they are
 * separate gestures of separate feet — a sustain curve drawn through a soft-pedal
 * instruction would be a picture of nothing. Which controllers are worth a row is the
 * segment's business, not this file's.
 */
export function pedalCurve(
    mpm: PerformanceReader,
    controller: string,
    from: number,
    to: number,
): CurvePoint[] {
    const lane = mpm.ofType('movement').filter(i => controllerOf(i) === controller);
    return walk(stretchesOf(lane, from, to, mpm.movementOf, positionAt), from, to);
}
