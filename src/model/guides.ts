/**
 * The guides of the dynamics curve, moved with the expansions of velocity.
 *
 * A guide — a phantom velocity of `InsertDynamicsInstructions` — is a value the curve has to pass
 * through, set on the plot of the velocities as the chain left them: after every `Expand`. So it
 * is a value on the expanded scale, and when an expansion comes or goes, the scale changes under
 * it. Left where it was, a guide set beside the softest notes would end up far above or below
 * them. Moved with the scale, it stays beside them.
 *
 * Done here, when a call is added or removed, rather than in the chain: the work file keeps
 * stating each guide as the value the curve passes through, which is what a reader of it expects
 * and what the dynamics desk draws, and undo takes the guides back with the call.
 *
 * Read structurally, as everything in `workReducer.ts` is: a file can name what this build does
 * not know, with options this build would not write.
 */
import type { Call } from './Work';
import { expansion, inverseExpansion, type ExpansionPoint } from '../fitting/expansion';

/** What of an expansion of velocity a guide can be moved by. */
interface VelocityExpansion {
    id: string;
    scope: unknown;
    range?: { from: number; to: number };
    points: ExpansionPoint[];
}

const isPoint = (point: unknown): point is ExpansionPoint =>
    Array.isArray(point) && point.length === 2 && point.every((v) => typeof v === 'number');

/**
 * The call as an expansion a guide can follow, or `null`.
 *
 * Only one of velocity, and only one by the score's dates or of everything. A guide is a point of
 * the curve at a date; an expansion of a list of notes has no dates to reach it by, without the
 * score this file does not hold, and so it moves no guide.
 */
const velocityExpansion = (call: Call): VelocityExpansion | null => {
    if (call.name !== 'Expand') return null;
    const { aspect, points, noteIDs, pedalIDs, from, to, scope } = call.options;
    if (aspect !== 'velocity' || !Array.isArray(points) || !points.every(isPoint)) return null;
    if (noteIDs !== undefined || pedalIDs !== undefined) return null;
    const range = typeof from === 'number' && typeof to === 'number' ? { from, to } : undefined;
    return { id: call.id, scope: scope ?? 'global', range, points };
};

/** Whether a velocity expansion reaches a guide of a curve in `scope` at `date`. */
const reaches = (expansion: VelocityExpansion, scope: unknown, date: number) =>
    (expansion.scope === 'global' || expansion.scope === scope) &&
    (!expansion.range || (expansion.range.from <= date && date <= expansion.range.to));

/** Whether the call is one that, added or removed, moves guides. */
export const movesGuides = (call: Call): boolean => velocityExpansion(call) !== null;

/**
 * A guide's value moved from the scale one series of expansions drew to the one another draws.
 *
 * What the two series share from the start ran on the guide alike and is kept. The rest of the
 * old series is undone, the last first, and the rest of the new one applied in order — so adding
 * an expansion at the end applies just that one, and removing one undoes it together with those
 * after it and applies those again. A call whose points draw no map changed nothing and is passed
 * over both ways; one that has no way back leaves the guide where it is.
 */
const move = (value: number, was: readonly VelocityExpansion[], is: readonly VelocityExpansion[]): number => {
    let shared = 0;
    while (shared < was.length && shared < is.length && was[shared].id === is[shared].id) shared++;
    if (shared === was.length && shared === is.length) return value;

    let moved = value;
    for (const { points } of was.slice(shared).reverse()) {
        if (!expansion(points)) continue;
        const back = inverseExpansion(points);
        if (!back) return value;
        moved = back(moved);
    }
    for (const { points } of is.slice(shared)) moved = expansion(points)?.(moved) ?? moved;
    return moved;
};

/**
 * `after`, with the guides of every `InsertDynamicsInstructions` call moved from the scale the
 * velocity expansions of `before` drew to the one those of `after` draw.
 *
 * A call whose guides do not move is returned as it was, by reference; one whose guides do gets
 * a new options object and a new `Map`, and nothing reachable from `before` is changed.
 */
export const followExpansions = (before: readonly Call[], after: readonly Call[]): Call[] => {
    const was = before.map(velocityExpansion).filter((e): e is VelocityExpansion => e !== null);
    const is = after.map(velocityExpansion).filter((e): e is VelocityExpansion => e !== null);

    return after.map((call) => {
        if (call.name !== 'InsertDynamicsInstructions') return call;
        const guides = call.options.phantomVelocities;
        if (!(guides instanceof Map) || guides.size === 0) return call;
        const scope = call.options.scope ?? 'global';

        let changed = false;
        const moved = new Map<unknown, unknown>();
        for (const [date, value] of guides as Map<unknown, unknown>) {
            if (typeof date !== 'number' || typeof value !== 'number') {
                moved.set(date, value);
                continue;
            }
            const next = move(
                value,
                was.filter((e) => reaches(e, scope, date)),
                is.filter((e) => reaches(e, scope, date)),
            );
            if (next !== value) changed = true;
            moved.set(date, next);
        }
        return changed ? { ...call, options: { ...call.options, phantomVelocities: moved } } : call;
    });
};
