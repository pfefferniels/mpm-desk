/**
 * A step of a remark, written out as the calls the chain runs.
 *
 * Most steps are one call. `Repeat` is one per stretch of a span, `FitSpread` one per rolled chord
 * of a passage, a `FitTempo` with a `step` one per stretch between chords. A roll over every chord
 * is written chord by chord as well, as the arpeggiation desk writes them: one call over all would
 * have to run after every call on a single chord, and a document keeps no such order.
 */
import type { Alignment } from '../alignment';
import type { Scope } from '../instructions/index';
import type { Call } from '../../model/Work';
import type { DescribeOptions } from '../transformers/description/Describe';
import { leanOf, rampVelocities } from '../transformers/ornamentation/InsertDynamicsGradient';
import { complete, refusal } from './complete';
import { chordsOf } from './steps';

/** A step of a remark, as `Describe` keeps it. */
export type Step = DescribeOptions['steps'][number];

/** A call still to be completed, and its place among the calls of its step. */
interface Draft {
    part: number;
    name: string;
    options: Record<string, unknown>;
}

/** Whether a step rolls every chord of its scope, and not the one on a date or a grace figure. */
export const rollsEveryChord = ({ name, options }: Step): boolean =>
    (name === 'InsertTemporalSpread' &&
        !('date' in options) &&
        !('group' in options) &&
        !('graces' in options)) ||
    (name === 'InsertDynamicsGradient' && !('date' in options));

const substitute = (value: unknown, bindings: Record<string, number>): unknown => {
    if (typeof value === 'string' && value in bindings) return bindings[value];
    if (Array.isArray(value)) return value.map((entry) => substitute(entry, bindings));
    if (value instanceof Map || value instanceof Set) return value;
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, substitute(entry, bindings)]),
        );
    }
    return value;
};

/** The stretches of `step` ticks between `from` and `to`, or why there are none. */
const stretches = (from: unknown, to: unknown, step: unknown): [number, number][] | string => {
    if (typeof from !== 'number' || typeof to !== 'number' || typeof step !== 'number') {
        return '"from", "to" and "step" have to be numbers, in ticks';
    }
    if (!(step > 0) || !(to > from)) return '"step" has to be positive and "to" after "from"';
    if ((to - from) / step > 400) return 'more than 400 steps';
    const spans: [number, number][] = [];
    for (let at = from; at < to - 1e-6; at += step) spans.push([at, Math.min(at + step, to)]);
    return spans;
};

const repeated = (options: Step['options'], piece: Alignment): Draft[] | string => {
    const template = options['call'] as Partial<Step> | undefined;
    const spans = stretches(options['from'], options['to'], options['step']);
    if (typeof spans === 'string') return `Repeat: ${spans}`;
    if (!template || typeof template.name !== 'string') return 'Repeat: no "call" to repeat';
    const { name } = template;
    const stated = template.options ?? {};
    if (name === 'Repeat' || name === 'FitSpread' || rollsEveryChord({ name, options: stated })) {
        return `Repeat: ${name} covers a passage by itself, and is not repeated over one`;
    }

    // A rubato frame needs two chords to redistribute.
    const sounding = chordsOf(piece).map((chord) => chord.date);
    const idle = ([from, to]: [number, number]) =>
        name === 'InsertRubato' && sounding.filter((date) => date >= from && date < to).length < 2;

    const drafts = spans.flatMap(([from, to], part) =>
        idle([from, to])
            ? []
            : [
                  {
                      part,
                      name,
                      options: substitute(stated, {
                          $from: from,
                          $to: to,
                          $step: to - from,
                          $index: part,
                      }) as Record<string, unknown>,
                  },
              ],
    );
    return drafts.length > 0
        ? drafts
        : `Repeat: no stretch between ticks ${spans[0]![0]} and ${spans.at(-1)![1]} holds two chords`;
};

/** One spread per chord of the scope that is rolled wider than the threshold. */
const spreads = (
    options: Step['options'],
    piece: Alignment,
    from: number,
    to: number,
    stated: Record<string, unknown>,
): Draft[] | string => {
    const scope = (options['scope'] ?? 'global') as Scope;
    const threshold =
        typeof options['durationThreshold'] === 'number' ? options['durationThreshold'] : 35;
    const chords = [...piece.in(scope).chords()].filter(
        ([date, chord]) => date >= from && date <= to && chord.length > 1,
    );
    const drafts = chords.flatMap(([date, chord], part) => {
        const onsets = chord.map((note) => note['milliseconds.date']).filter(Number.isFinite);
        if (onsets.length < 2 || Math.max(...onsets) - Math.min(...onsets) <= threshold) return [];
        return [{ part, name: 'InsertTemporalSpread', options: { ...stated, scope, date } }];
    });
    return drafts.length > 0 ? drafts : `no chord there is spread wider than ${threshold} ms`;
};

/** One gradient per chord whose velocities lean, each with the ramp its direction calls for. */
const gradients = (options: Step['options'], piece: Alignment): Draft[] | string => {
    const scope = (options['scope'] ?? 'global') as Scope;
    const sortVelocities = options['sortVelocities'] !== false;
    const ramps = {
        crescendo: options['crescendo'] ?? { from: -1, to: 0 },
        decrescendo: options['decrescendo'] ?? { from: 0, to: -1 },
    };
    const chords = [...piece.in(scope).chords()].filter(([date, chord]) =>
        'date' in options ? date === options['date'] : chord.length > 1,
    );
    const drafts = chords.flatMap(([date, chord], part) => {
        const lean = leanOf(chord);
        const ramp = rampVelocities(chord, sortVelocities);
        if (!lean || ramp[0] === ramp.at(-1)) return [];
        return [
            {
                part,
                name: 'InsertDynamicsGradient',
                options: { scope, sortVelocities, date, gradient: ramps[lean] },
            },
        ];
    });
    return drafts.length > 0 ? drafts : 'no chord there has velocities that lean one way';
};

/**
 * A tempo is fitted between chords: the span is cut on the chord nearest each step, within half
 * a step of it, and not at all where there is none.
 */
const steppedTempo = (options: Step['options'], piece: Alignment): Draft[] | string => {
    const { step, ...rest } = options;
    const spans = stretches(options['from'], options['to'], step);
    if (typeof spans === 'string') return `FitTempo: ${spans}`;

    const sounding = chordsOf(piece).map((chord) => chord.date);
    const first = spans[0]![0];
    const last = spans.at(-1)![1];
    const reach = (step as number) / 2;
    const cuts = new Set<number>();
    for (const [at] of spans.slice(1)) {
        const near = sounding
            .filter((date) => date > first && date < last && Math.abs(date - at) < reach)
            .sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || b - a)[0];
        if (near !== undefined) cuts.add(near);
    }
    const edges = [first, ...[...cuts].sort((a, b) => a - b), last];
    const cut: [number, number][] = [];
    for (let i = 0; i + 1 < edges.length; i++) cut.push([edges[i]!, edges[i + 1]!]);
    // A last stretch without a chord has no tempo to read off, and goes to the one before.
    const final = cut.at(-1);
    if (cut.length > 1 && final && !sounding.some((date) => date > final[0] && date <= final[1])) {
        cut.pop();
        cut.at(-1)![1] = final[1];
    }
    return cut.map(([from, to], part) => ({
        part,
        name: 'FitTempo',
        options: { ...rest, from, to },
    }));
};

const drafted = ({ name, options }: Step, piece: Alignment): Draft[] | string => {
    if (name === 'Repeat') return repeated(options, piece);
    if (name === 'FitSpread') {
        const { from, to, placement } = options;
        if (typeof from !== 'number' || typeof to !== 'number' || to < from) {
            return 'FitSpread: "from" and "to" have to be ticks, "to" not before "from"';
        }
        const made = spreads(options, piece, from, to, { placement: placement ?? 'estimate' });
        return typeof made === 'string'
            ? `FitSpread: between ticks ${from} and ${to}, ${made}`
            : made;
    }
    if (name === 'InsertTemporalSpread' && rollsEveryChord({ name, options })) {
        const { durationThreshold: _threshold, ...stated } = options;
        void _threshold;
        const made = spreads(options, piece, -Infinity, Infinity, stated);
        return typeof made === 'string' ? `${name}: ${made}` : made;
    }
    if (name === 'InsertDynamicsGradient' && !('date' in options && 'gradient' in options)) {
        const made = gradients(options, piece);
        return typeof made === 'string' ? `${name}: ${made}` : made;
    }
    if (name === 'FitTempo' && options['step'] !== undefined) return steppedTempo(options, piece);
    return [{ part: 0, name, options }];
};

/**
 * The calls a step comes to, completed, or why it comes to none.
 *
 * @param id what the calls are named after: each is `${id}.${part}`, its part being its place
 * among the calls of the step.
 * @param piece the recording as played, which says where a chord sounds and how wide it is rolled.
 */
export const expand = (
    step: Step,
    id: string,
    piece: Alignment,
): { part: number; call: Call }[] | string => {
    const drafts = drafted(step, piece);
    if (typeof drafts === 'string') return drafts;

    const calls: { part: number; call: Call }[] = [];
    for (const { part, name, options } of drafts) {
        const call = refusal(name) ?? complete({ id: `${id}.${part}`, name, options });
        if (typeof call === 'string') return call;
        calls.push({ part, call });
    }
    return calls;
};
