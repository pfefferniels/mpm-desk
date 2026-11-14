/**
 * The published reconstruction's pedal ramps, turned into the lines they describe.
 *
 * The reconstruction of WM 225 pedals every press with two calls of `InsertPedal`'s shortcut, a
 * ramp down and a ramp up, typed in ticks off the press's ends at a depth typed rather than read.
 * Since the line became part of the record, that is the corrections desk's to say and the pedal
 * desk's to trace: `CorrectPedal` states what the pedal did, and `InsertPedal` naming only the
 * press fits movements to it, as `InsertDynamics` fits a curve to the velocities.
 *
 * So each press's two ramps become, in this order:
 *
 * - a `CorrectPedal` redrawing the press as the line the two ramps draw: down along the one, held
 *   at its depth, up along the other, and released where that arrives;
 * - a `Modify` of the press's onset where the ramp down starts before the recorded onset, as most
 *   do, a hundred ticks early: a line starts where its press does;
 * - an `InsertPedal` naming the press, which fits the movements to that line.
 *
 * What is kept is what sounded. Each vertex is placed in the milliseconds that fall where the ramp
 * had it on the tick grid `InsertPedal` measures a press against; the calls before it change
 * presses only, and the grid is the notes' and the tempo's, so it is the same grid after the
 * migration as before. Along each ramp the line samples the bend a `<movement>` takes when it
 * states none, which is where the fit starts its search (`approximateMovement.ts`), and the fit
 * writes that bend. A ramp the renderer never drew, being dated before the score begins, is not
 * drawn either: there the pedal went down at once where the ramp arrives, and so does the line.
 *
 * Each call keeps an id: a link to the down ramp opens the trace of the press, a link to the up
 * ramp the line now holding it. The `Modify` has an id derived from the down ramp's, so that
 * running this twice on the same file writes the same one.
 *
 * Nothing here reads or writes a file; `migratePedalRamps.ts` is the command.
 */
import { JSDOM } from 'jsdom';

// `asMSM` reads the MEI with the platform `DOMParser`, which node has not got.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser ??= new JSDOM().window.DOMParser;

import { convertMeiToMsm, innerControlPointsXPositions, transitionValueAt } from 'espressivo';
import { v5 } from 'uuid';
import { asMSM } from '../src/fitting/asMSM';
import { buildChain } from '../src/fitting/chain';
import { Alignment, type AlignedPedal } from '../src/fitting/alignment';
import { createMpm, scopesOf, type Mpm } from '../src/fitting/instructions/index';
import { clearResidualCache, deriveResidual } from '../src/fitting/residual';
import { placeTempos, segmentAtMs } from '../src/fitting/transformers/tempo/placedTempos';
import { dateAtMilliseconds } from '../src/fitting/transformers/tempo/tempoCalculations';
import type { TickVertex } from '../src/fitting/transformers/tempo/tickTimes';
import { approximateMovements } from '../src/fitting/transformers/pedal/approximateMovement';
import { isPressTravel, type Travel, type TravelVertex } from '../src/performance/pedalTravel';
import type { Call, WorkFile } from '../src/model/Work';

/** A call of the shortcut, as the published file has it. */
interface Ramp {
    pedal: string;
    start: number;
    duration: number;
    direction: 'up' | 'down';
    depth?: number;
}

const isRamp = (call: Call): boolean => call.name === 'InsertPedal' && 'direction' in call.options;

/** A `<movement>`'s bend where it states none: espressivo's default, and the fit's first guess. */
const [X1, X2] = innerControlPointsXPositions(0.4, 0);

/** Where a ramp has the pedal at `date`: the shortcut's transition, rendered. */
const rampAt = (from: number, to: number, startDate: number, endDate: number, date: number): number =>
    transitionValueAt(X1, X2, startDate, endDate, from, to, date);

/** Two decimals, as the desk writes a position (`asWritten`), so what is drawn is what is saved. */
const asWritten = (position: number): number => Math.round(Math.min(1, Math.max(0, position)) * 100) / 100;

/** Where a millisecond of the recording falls on the score grid, and the inverse, to the millisecond. */
interface Grid {
    tick(ms: number): number;
    /** The whole millisecond whose tick comes closest to `date`, searched near `near`. */
    msAt(date: number, near: number): number;
}

/**
 * The grid `InsertPedal` places a press on: the tempo segments of the first scope that has any,
 * which places every pedal first (`tickTimes.ts`), each millisecond measured from its segment's
 * anchored start.
 *
 * Not monotonic everywhere — at a tempo boundary the cursor is re-anchored on the recorded onset —
 * so the inverse searches rather than solving: a window of the record either side of a guess.
 */
const gridOf = (msm: Alignment, mpm: Mpm): Grid => {
    const scope = scopesOf(mpm).find((s) => placeTempos(msm, mpm, s).length > 0);
    if (scope === undefined) throw new Error('No tempo places the pedals yet');
    const segments = placeTempos(msm, mpm, scope);
    const tick = (ms: number): number => {
        const segment = segmentAtMs(segments, ms);
        if (!segment) throw new Error(`No tempo covers ${String(ms)} ms`);
        return dateAtMilliseconds(ms - segment.startMs, segment.resolved);
    };
    // Out from the guess until the date is passed, halved down to the millisecond, then the
    // neighbourhood searched: where the cursor was re-anchored, the closest is not always the
    // first to pass.
    const msAt = (date: number, near: number): number => {
        let lo = Math.round(near);
        let hi = lo;
        for (let step = 1; tick(lo) > date; step *= 2) lo -= step;
        for (let step = 1; tick(hi) < date; step *= 2) hi += step;
        while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (tick(mid) < date) lo = mid;
            else hi = mid;
        }
        let best = lo;
        for (let ms = lo - 50; ms <= hi + 50; ms++) {
            if (Math.abs(tick(ms) - date) < Math.abs(tick(best) - date)) best = ms;
        }
        return best;
    };
    return { tick, msAt };
};

/** The recording as the first `InsertPedal` finds it, and the grid it places a press on. */
interface BeforePedalling {
    msm: Alignment;
    grid: Grid;
    /** Where the residual puts a press on the grid; every press this migrates has a place. */
    placed(pedal: AlignedPedal): { tickDate: number; tickDuration: number };
}

const beforePedalling = (work: WorkFile, mei: string): BeforePedalling => {
    const movement = convertMeiToMsm(mei)[0];
    // The chain is noisy about MSM parts it cannot match; that is a property of the fixture.
    const say = console.log;
    console.log = () => undefined;
    try {
        const msm = asMSM(mei, movement.msm, movement.graces);
        clearResidualCache();
        const mpm = createMpm();
        for (const transformer of buildChain(work.provenance).transformers) {
            if (transformer.name === 'InsertPedal') break;
            transformer.run(msm, mpm);
        }
        const residual = deriveResidual(msm, mpm, { without: ['movement'] });
        const placed = (pedal: AlignedPedal) => {
            const { tickDate, tickDuration } = residual.ofPedal(pedal) ?? {};
            if (tickDate === undefined || tickDuration === undefined) {
                throw new Error(`${pedal['xml:id']} is not on the grid`);
            }
            return { tickDate, tickDuration };
        };
        return { msm, grid: gridOf(msm, mpm), placed };
    } finally {
        console.log = say;
    }
};

/** One traversal of a ramp, as the stretch of milliseconds it is drawn over. */
interface Traversal {
    /** The ramp itself, in ticks, and the positions it runs between. */
    startDate: number;
    endDate: number;
    from: number;
    to: number;
    /** Where its first and last vertex go, in milliseconds of the recording. */
    firstMs: number;
    lastMs: number;
}

/** Where, between a traversal's ends, it is drawn through: milliseconds of the recording. */
type Placement = (grid: Grid, traversal: Traversal) => number[];

/** The ramp a quarter, half and three quarters of the way, by the score. */
const quarters: Placement = (grid, { startDate, endDate, firstMs }) =>
    [0.25, 0.5, 0.75].map((fraction) => grid.msAt(startDate + fraction * (endDate - startDate), firstMs));

/**
 * One vertex, where the ramp has gone as far as the two halves either side of it need to move at
 * one pace.
 *
 * For a ramp so slow that a quarter of it, at a flat end of its bend, is slower than the fit's
 * slowest traversal and reads as a hold. Of all the ways to split it this keeps both halves as
 * fast as the whole, so where the whole is a traversal, so are they.
 */
const evenly: Placement = (grid, traversal) => {
    const { firstMs, lastMs } = traversal;
    const first = positionOf(grid, traversal, firstMs);
    const last = traversal.to;
    let best = Math.round((firstMs + lastMs) / 2);
    let unevenness = Infinity;
    for (let ms = firstMs + 1; ms < lastMs; ms++) {
        const position = positionOf(grid, traversal, ms);
        const before = Math.abs(position - first) / (ms - firstMs);
        const after = Math.abs(last - position) / (lastMs - ms);
        if (Math.abs(before - after) < unevenness) {
            unevenness = Math.abs(before - after);
            best = ms;
        }
    }
    return [best];
};

/** Where the ramp has the pedal at a millisecond of the recording, as the line would save it. */
const positionOf = (grid: Grid, { startDate, endDate, from, to }: Traversal, ms: number): number =>
    asWritten(rampAt(from, to, startDate, endDate, grid.tick(ms)));

/** A traversal's vertices: its ends, and what `placement` puts between them that falls inside. */
const drawn = (grid: Grid, traversal: Traversal, placement: Placement): TravelVertex[] => {
    const { firstMs, lastMs, to } = traversal;
    const inner = placement(grid, traversal)
        .filter((ms, i, all) => ms > firstMs && ms < lastMs && all.indexOf(ms) === i)
        .map((ms) => ({ ms, position: positionOf(grid, traversal, ms) }));
    return [{ ms: firstMs, position: positionOf(grid, traversal, firstMs) }, ...inner, { ms: lastMs, position: to }];
};

/** The kinds of movement the fit makes of a line, in order. */
const shapeOf = (line: readonly TickVertex[]): string =>
    approximateMovements(line)
        .map((movement) => (movement.transitionTo === undefined ? 'constant' : 'transition'))
        .join();

export interface MigratedPress {
    pedal: string;
    /** Milliseconds the onset moved: earlier where negative. */
    onsetChange: number;
    travel: Travel;
    /** How far, in ticks, the line's turning points land from where the ramps had them. */
    worstTickError: number;
    /**
     * The down ramp starts before the score does, where the renderer draws no movement (espressivo's
     * `MovementMap` skips one at a negative date). What sounded was the pedal going down at once
     * where the ramp arrives, so the line stays at rest from the onset until then and steps down.
     */
    unrenderedDown: boolean;
}

export interface Migration {
    work: WorkFile;
    presses: MigratedPress[];
}

/**
 * The work file with every press's two ramps replaced by its line, an onset correction where the
 * ramp asked for one, and a trace. Calls other than the ramps are left as they are, in place.
 */
export const migratePedalRamps = (work: WorkFile, mei: string): Migration => {
    const ramps = new Map<string, { down?: Call; up?: Call }>();
    for (const call of work.provenance.filter(isRamp)) {
        const { pedal, direction } = call.options as unknown as Ramp;
        const pair = ramps.get(pedal) ?? {};
        if (pair[direction]) throw new Error(`${pedal} has two ramps ${direction}`);
        pair[direction] = call;
        ramps.set(pedal, pair);
    }
    if (ramps.size === 0) return { work, presses: [] };

    const { msm, grid, placed } = beforePedalling(work, mei);
    const presses: MigratedPress[] = [];
    const replacing = new Map<string, Call[]>();

    for (const [id, { down, up }] of ramps) {
        if (!down || !up) throw new Error(`${id} has a ramp ${down ? 'down' : 'up'} only, and no line to draw`);
        const pedal = msm.pedals.find((p) => p['xml:id'] === id);
        if (!pedal) throw new Error(`${id} is no press of the chosen reading`);
        if (pedal.travel) throw new Error(`${id} has a line of its own already`);

        const downRamp = down.options as unknown as Ramp;
        const upRamp = up.options as unknown as Ramp;
        // `??` as `InsertPedal` reads it: a depth of 0 is a depth.
        const depth = downRamp.depth ?? 1;
        if ((upRamp.depth ?? 1) !== depth) throw new Error(`${id} goes down to one depth and up from another`);

        const onset = pedal['milliseconds.date'];
        const { tickDate, tickDuration } = placed(pedal);
        const release = tickDate + tickDuration;
        const a = tickDate + downRamp.start;
        const b = a + downRamp.duration;
        const c = release + upRamp.start;
        const e = c + upRamp.duration;
        if (!(a < b && b <= c && c < e)) throw new Error(`${id}'s ramps overlap`);

        const unrenderedDown = a < 0;
        const msB = grid.msAt(b, onset);
        const msC = grid.msAt(c, pedal['milliseconds.date.end']);
        const msE = grid.msAt(e, pedal['milliseconds.date.end']);
        // Where the ramp was rendered the line starts with it, and the onset moves there. Where it
        // was not, the onset stays: the recording starts at zero (`shiftToFirstOnset` clamps a
        // press already down before the first note to it), and a ramp before then is before it.
        const firstMs = unrenderedDown ? onset : grid.msAt(a, onset);
        if (firstMs < 0 || firstMs > msB) throw new Error(`${id} would start outside the recording`);

        const traversals = (placement: Placement) => [
            ...(unrenderedDown
                ? [...(firstMs < msB ? [{ ms: firstMs, position: 0 }] : []), { ms: msB, position: depth }]
                : drawn(grid, { startDate: a, endDate: b, from: 0, to: depth, firstMs, lastMs: msB }, placement)),
            ...drawn(grid, { startDate: c, endDate: e, from: depth, to: 0, firstMs: msC, lastMs: msE }, placement),
        ];
        const onTicks = (vertices: readonly TravelVertex[]): TickVertex[] =>
            vertices.map(({ ms, position }) => ({ date: grid.tick(ms), ms: ms - firstMs, position }));

        // What the ramps rendered as: down, held, up and at rest, or without the first where the
        // renderer skipped it.
        const rendered = unrenderedDown
            ? `${firstMs < msB ? 'constant,' : ''}constant,transition,constant`
            : 'transition,constant,transition,constant';
        const vertices = [quarters, evenly]
            .map(traversals)
            .find((candidate) => shapeOf(onTicks(candidate)) === rendered);
        if (!vertices) throw new Error(`${id}'s line would not trace as its ramps rendered`);

        const travel = vertices.map(({ ms, position }) => ({ ms: ms - firstMs, position }));
        if (!isPressTravel(travel)) throw new Error(`${id}'s line is not the line of a press`);

        const onsetChange = firstMs - onset;
        const landed = [...(unrenderedDown ? [] : [[firstMs, a]]), [msB, b], [msC, c], [msE, e]];
        presses.push({
            pedal: id,
            onsetChange,
            travel,
            worstTickError: Math.max(...landed.map(([ms, date]) => Math.abs(grid.tick(ms) - date))),
            unrenderedDown,
        });

        replacing.set(down.id, [
            { id: up.id, name: 'CorrectPedal', options: { pedal: id, travel } },
            ...(onsetChange === 0
                ? []
                : [
                      {
                          id: v5(`onset of ${id}`, down.id),
                          name: 'Modify',
                          options: { pedalIDs: [id], scope: 'global', aspect: 'onset', change: onsetChange },
                      },
                  ]),
            { id: down.id, name: 'InsertPedal', options: { pedal: id } },
        ]);
        replacing.set(up.id, []);
    }

    const provenance = work.provenance.flatMap((call) => replacing.get(call.id) ?? [call]);
    return { work: { ...work, provenance }, presses };
};
