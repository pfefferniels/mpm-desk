/**
 * The calls of every remark, settled among themselves: a later remark owns its place.
 *
 * A remark made today may be about a place somebody spoke of yesterday. A tempo or a dynamics span
 * is cut out of every earlier one, which is fitted again over what it has left; a rubato replaces
 * those it overlaps; a roll replaces an earlier one on the same chord. A roll said of one chord
 * stands against one said of every chord, whichever was said first.
 */
import type { Call } from '../../model/Work';

/** A call a step of a remark came to, and which step that was. */
export interface StepCall {
    call: Call;
    /** The id of the remark's `Describe` call. */
    remark: string;
    /** The step's position among the remark's steps. */
    step: number;
    /** The call's place among the calls the step was written out as; see `expand`. */
    part: number;
    /** One of a roll over every chord, which gives way to a roll said of its chord alone. */
    general?: boolean;
}

/** The calls that state a tempo over a span, fitted or given; and those that state dynamics. */
export const TEMPO = new Set(['FitTempo', 'InsertTempo']);
export const DYNAMICS = new Set(['FitDynamics', 'InsertDynamics']);
const ROLLS = new Set(['InsertTemporalSpread', 'InsertDynamicsGradient']);

const numbers = ({ options }: Call, a: string, b: string): [number, number] => [
    options[a] as number,
    options[b] as number,
];

/**
 * The calls with every overlap resolved for the later, each named `${remark}.${step}.${part}`.
 * Where a part came to several calls, cut in two by a later span, those after the first are
 * numbered: `….${part}.1`, `….${part}.2`.
 *
 * @param calls in the order the remarks were made, and within a remark in the order of its steps.
 */
export const settle = (calls: readonly StepCall[]): StepCall[] => {
    const out: StepCall[] = [];

    const carve = (family: Set<string>, from: number, to: number) => {
        for (let i = out.length - 1; i >= 0; i--) {
            const earlier = out[i]!;
            if (!family.has(earlier.call.name)) continue;
            const [start, end] = numbers(earlier.call, 'from', 'to');
            if (end <= from || start >= to) continue;
            const left: StepCall[] = [];
            const cut = (options: Record<string, unknown>): StepCall => ({
                ...earlier,
                call: { ...earlier.call, options: { ...earlier.call.options, ...options } },
            });
            if (start < from) left.push(cut({ to: from }));
            // An `InsertTempo` is stated from its start, so what the cut leaves after it is dropped.
            if (end > to && earlier.call.name !== 'InsertTempo') left.push(cut({ from: to }));
            out.splice(i, 1, ...left);
        }
    };

    const drop = (overlapped: (earlier: StepCall) => boolean) => {
        for (let i = out.length - 1; i >= 0; i--) {
            if (overlapped(out[i]!)) out.splice(i, 1);
        }
    };

    for (const entry of calls) {
        const { call } = entry;
        if (TEMPO.has(call.name) || DYNAMICS.has(call.name)) {
            const [from, to] = numbers(call, 'from', 'to');
            // A span of no length cuts nothing.
            if (to > from) carve(TEMPO.has(call.name) ? TEMPO : DYNAMICS, from, to);
        } else if (call.name === 'InsertRubato') {
            const [date, length] = numbers(call, 'date', 'length');
            drop(({ call: earlier }) => {
                if (earlier.name !== 'InsertRubato') return false;
                const [start, span] = numbers(earlier, 'date', 'length');
                return start < date + length && start + span > date;
            });
        } else if (ROLLS.has(call.name) && typeof call.options['date'] === 'number') {
            const onItsChord = ({ call: earlier }: StepCall) =>
                earlier.name === call.name &&
                earlier.options['date'] === call.options['date'] &&
                earlier.options['scope'] === call.options['scope'];
            if (entry.general && out.some((earlier) => onItsChord(earlier) && !earlier.general))
                continue;
            drop(onItsChord);
        }
        out.push(entry);
    }

    // In place, so that the pieces of a part stand in score order where it was cut.
    const pieces = new Map<string, number>();
    return out.map((entry) => {
        const id = `${entry.remark}.${entry.step}.${entry.part}`;
        const piece = pieces.get(id) ?? 0;
        pieces.set(id, piece + 1);
        return { ...entry, call: { ...entry.call, id: piece === 0 ? id : `${id}.${piece}` } };
    });
};
