/**
 * Calls that speak of the same place, settled: the later statement owns it.
 *
 * A remark made today may be about a place somebody spoke of yesterday. A tempo or a dynamics span
 * is cut out of every earlier one, which is fitted or stated again over what it has left; a rubato
 * replaces those it overlaps; a roll replaces an earlier one on the same chord, a pedal's line an
 * earlier one of the same press. What is said of one chord or one press stands against what is
 * said of every one, whichever was said first.
 *
 * The same holds between a remark and the calls made by hand on other desks, where "later" is
 * decided by what the reader is doing. A remark on trial is later than every call made by hand, and
 * takes their place. A remark the document holds already is earlier than the calls made by hand
 * that still stand in its place: they were made after it, or kept when it was written.
 */
import type { Call } from '../../model/Work';
import { getTempoAt } from '../transformers/tempo/tempoCalculations';

/** A call a step of a remark came to, and which step that was. */
export interface StepCall {
    call: Call;
    /** The id of the remark's `Describe` call. */
    remark: string;
    /** The step's position among the remark's steps. */
    step: number;
    /** The call's place among the calls the step was written out as; see `expand`. */
    part: number;
    /** Said of every chord or every press, and so giving way to what is said of one alone. */
    general?: boolean;
}

/** What settling asks of the score. */
export interface Places {
    /** The dates a chord stands on, ascending. */
    dates: readonly number[];
    /** The dates of the chords a roll over every chord of its scope describes. */
    rolled: (call: Call) => ReadonlySet<number>;
}

/** The calls that state a tempo over a span, fitted or given; and those that state dynamics. */
export const TEMPO = new Set(['FitTempo', 'InsertTempo']);
export const DYNAMICS = new Set(['FitDynamics', 'InsertDynamics']);
const ROLLS = new Set(['InsertTemporalSpread', 'InsertDynamicsGradient']);

const scopeOf = ({ options }: Call) => options['scope'] ?? 'global';

const spanOf = ({ options }: Call): [number, number] | undefined => {
    const { from, to } = options;
    return typeof from === 'number' && typeof to === 'number' ? [from, to] : undefined;
};

/** Whether a call speaks of every chord of its scope, or of every press, and not of one. */
export const everywhere = ({ name, options }: Pick<Call, 'name' | 'options'>): boolean =>
    (name === 'InsertTemporalSpread' &&
        !('date' in options) &&
        !('group' in options) &&
        !('graces' in options)) ||
    (name === 'InsertDynamicsGradient' && !('date' in options)) ||
    (name === 'InsertPedal' && !('pedal' in options));

/** Whether two calls speak of the same single chord, or of the same single press. */
const onOnePlace = (a: Call, b: Call): boolean => {
    if (a.name !== b.name || scopeOf(a) !== scopeOf(b)) return false;
    if (a.name === 'InsertPedal') {
        return typeof a.options['pedal'] === 'string' && a.options['pedal'] === b.options['pedal'];
    }
    return (
        ROLLS.has(a.name) &&
        typeof a.options['date'] === 'number' &&
        a.options['date'] === b.options['date']
    );
};

/**
 * A tempo over a part of its span. A fitted one is fitted again over it. A stated one keeps its
 * line: up to a cut it is the same curve to the letter, and from a cut on it starts at the tempo
 * it had there and reaches its own mean tempo where the line did, which is as near as one
 * `<tempo>` comes to the rest of another.
 */
const tempoOver = (tempo: Call, from: number, to: number): Call => {
    const { options } = tempo;
    const span = spanOf(tempo);
    const { bpm, transitionTo, meanTempoAt, beatLength } = options;
    const plain = { id: tempo.id, name: tempo.name, options: { ...options, from, to } };
    if (tempo.name !== 'InsertTempo' || !span || typeof transitionTo !== 'number') return plain;
    if (typeof bpm !== 'number' || typeof beatLength !== 'number') return plain;

    const line = {
        date: span[0],
        endDate: span[1],
        bpm,
        transitionTo,
        beatLength,
        meanTempoAt: typeof meanTempoAt === 'number' ? meanTempoAt : 0.5,
    };
    const [starts, arrives] = [getTempoAt(from, line), getTempoAt(to, line)];
    if (!Number.isFinite(starts) || !Number.isFinite(arrives)) return plain;
    if (Math.abs(arrives - starts) < 1e-9) {
        const steady = Object.entries(plain.options).filter(
            ([key]) => key !== 'transitionTo' && key !== 'meanTempoAt',
        );
        return { ...plain, options: { ...Object.fromEntries(steady), bpm: starts } };
    }
    // Cut at its end only, the curve is the one it was, the shape included.
    if (from === span[0]) return { ...plain, options: { ...plain.options, transitionTo: arrives } };

    const mean = (starts + arrives) / 2;
    let [low, high] = [from, to];
    for (let i = 0; i < 50; i++) {
        const middle = (low + high) / 2;
        if (getTempoAt(middle, line) < mean === arrives > starts) low = middle;
        else high = middle;
    }
    return {
        ...plain,
        options: {
            ...plain.options,
            bpm: starts,
            transitionTo: arrives,
            meanTempoAt: Math.min(0.99, Math.max(0.01, (low - from) / (to - from))),
        },
    };
};

/** The dates dynamics can be stated on: the chords', and the call's own guides between them. */
const pointsOf = ({ options }: Call, places: Places): number[] => {
    const guides = options['guides'] instanceof Map ? [...options['guides'].keys()] : [];
    return [...places.dates, ...guides.filter((date) => typeof date === 'number')];
};

/**
 * What a later call leaves of an earlier one: the call itself where the two do not meet, what
 * remains of it where they do, nothing where the later one takes all of its place.
 *
 * A tempo span ends short of its `to`, and a later one takes `[from, to)`. A dynamics span holds
 * the chord on its `to`, and its last instruction stands there, so what is left of an earlier one
 * ends on the chord before the later span and begins again on the chord after it: on the later
 * span's own first date nothing else may stand, or the later one would write nothing.
 */
export const leave = (earlier: Call, later: Call, places: Places): Call[] => {
    const untouched = [earlier];

    for (const family of [TEMPO, DYNAMICS]) {
        if (!family.has(earlier.name) || !family.has(later.name)) continue;
        const [was, takes] = [spanOf(earlier), spanOf(later)];
        if (!was || !takes || scopeOf(earlier) !== scopeOf(later)) return untouched;
        const [[a, b], [f, t]] = [was, takes];
        // A span of no length takes no place.
        if (!(t > f)) return untouched;

        if (family === TEMPO) {
            // Its own `<tempo>` stands inside, or its span reaches in from before.
            if (!(a >= f ? a < t : b > f)) return untouched;
            return [
                ...(a < f ? [tempoOver(earlier, a, f)] : []),
                ...(b > t ? [tempoOver(earlier, t, b)] : []),
            ];
        }

        if (a > t || b < f) return untouched;
        const points = pointsOf(earlier, places);
        const before = Math.max(...points.filter((date) => date >= a && date < f));
        const after = Math.min(...points.filter((date) => date > t && date <= b));
        const cut = (options: Record<string, number>): Call => ({
            id: earlier.id,
            name: earlier.name,
            options: { ...earlier.options, ...options },
        });
        return [
            ...(Number.isFinite(before) ? [cut({ to: before })] : []),
            ...(Number.isFinite(after) ? [cut({ from: after })] : []),
        ];
    }

    if (earlier.name === 'InsertRubato' && later.name === 'InsertRubato') {
        if (scopeOf(earlier) !== scopeOf(later)) return untouched;
        const frame = ({ options }: Call) =>
            [options['date'], options['length']] as [number, number];
        const [[start, span], [date, length]] = [frame(earlier), frame(later)];
        return start < date + length && start + span > date ? [] : untouched;
    }

    if (onOnePlace(earlier, later)) return [];
    // What is said of every chord, or of every press, is said of this one too.
    if (earlier.name === later.name && scopeOf(earlier) === scopeOf(later) && everywhere(later)) {
        if (earlier.name === 'InsertPedal') return 'pedal' in earlier.options ? [] : untouched;
        const { date } = earlier.options;
        return typeof date === 'number' && places.rolled(later).has(date) ? [] : untouched;
    }
    return untouched;
};

/**
 * The earlier calls with each of the later ones taking its place of them; and, for every earlier
 * call something was taken of, which of the later took it and what is left.
 */
const yieldTo = <T extends { call: Call }>(
    earlier: readonly T[],
    later: readonly Call[],
    places: Places,
): { left: T[]; took: Map<T, { takers: Call[]; rest: T[] }> } => {
    const left: T[] = [];
    const took = new Map<T, { takers: Call[]; rest: T[] }>();
    for (const entry of earlier) {
        let calls = [entry.call];
        const takers: Call[] = [];
        for (const taker of later) {
            const next = calls.flatMap((call) => leave(call, taker, places));
            if (next.length === calls.length && next.every((call, i) => call === calls[i]))
                continue;
            takers.push(taker);
            calls = next;
        }
        const rest = takers.length === 0 ? [entry] : calls.map((call) => ({ ...entry, call }));
        if (takers.length > 0) took.set(entry, { takers, rest });
        left.push(...rest);
    }
    return { left, took };
};

/**
 * The calls of the remarks settled among themselves, every overlap resolved for the later.
 *
 * @param calls in the order the remarks were made, and within a remark in the order of its steps.
 */
const amongRemarks = (calls: readonly StepCall[], places: Places): StepCall[] => {
    let out: StepCall[] = [];
    for (const entry of calls) {
        const spokenFor = (earlier: StepCall) =>
            !earlier.general && onOnePlace(earlier.call, entry.call);
        if (entry.general && out.some(spokenFor)) continue;
        out = yieldTo(out, [entry.call], places).left;
        out.push(entry);
    }
    return out;
};

/** A call made by hand that a remark on trial takes the place of. */
export interface Displaced {
    /** The call as the document holds it. */
    call: Call;
    /**
     * What is left of it: the calls to put in its place, none where it goes entirely. The first
     * keeps the call's id; a further one is `${id}.1`, or the next such id the document has free.
     */
    left: Call[];
}

interface Settled {
    /**
     * The remarks' calls, each named `${remark}.${step}.${part}`. Where a part came to several
     * calls, cut in two by a later span, those after the first are numbered: `….${part}.1`.
     */
    calls: StepCall[];
    /**
     * The calls made by hand as they stand once the remark on trial has taken its place: those it
     * leaves alone, in their order, then what is left of the others.
     */
    byHand: Call[];
    /** What the remark on trial displaces, and which of its calls do. */
    displaced: (Displaced & { by: StepCall[] })[];
    /** The calls of the remarks, as they were written out, that gave way to calls made by hand. */
    gaveWay: { entry: StepCall; to: Call[] }[];
}

/**
 * The remarks' calls and the calls made by hand, settled.
 *
 * @param calls the remarks' calls in the order the remarks were made, and within a remark in the
 * order of its steps.
 * @param byHand the calls made by hand, in the order of the document.
 * @param trial the id of the remark on trial, if one is.
 * @param taken every id the document uses, so that what is left of a call is named anew.
 */
export const settle = (
    calls: readonly StepCall[],
    byHand: readonly Call[],
    trial: string | undefined,
    taken: ReadonlySet<string>,
    places: Places,
): Settled => {
    const among = amongRemarks(calls, places);
    const gaveWay: Settled['gaveWay'] = [];
    const behind = ({ left, took }: ReturnType<typeof yieldTo<StepCall>>) => {
        for (const [entry, { takers }] of took) gaveWay.push({ entry, to: takers });
        return left;
    };

    // What a call made by hand says of every chord, or of every press, is not undone for one of
    // them: there a remark stands behind it even on trial.
    const tried = behind(
        yieldTo(
            among.filter((entry) => entry.remark === trial),
            byHand.filter(everywhere),
            places,
        ),
    );

    const takers = new Map(tried.map((entry) => [entry.call, entry]));
    const taking = yieldTo(
        byHand.map((call) => ({ call })),
        [...takers.keys()],
        places,
    );
    const ids = new Set(taken);
    const free = (id: string) => {
        let n = 1;
        while (ids.has(`${id}.${n}`)) n++;
        ids.add(`${id}.${n}`);
        return `${id}.${n}`;
    };
    const displaced = [...taking.took].map(([{ call }, { takers: by, rest }]) => ({
        call,
        left: rest.map((left, piece) =>
            piece === 0 ? left.call : { ...left.call, id: free(call.id) },
        ),
        by: by.map((taker) => takers.get(taker)!),
    }));
    const gone = new Set(displaced.map(({ call }) => call));
    const remaining = [
        ...byHand.filter((call) => !gone.has(call)),
        ...displaced.flatMap(({ left }) => left),
    ];

    const written = behind(
        yieldTo(
            among.filter((entry) => entry.remark !== trial),
            remaining,
            places,
        ),
    );

    // In the order they stand in, so that the pieces of a part are numbered in score order.
    const pieces = new Map<string, number>();
    const named = new Map<StepCall, StepCall>();
    for (const entry of [...written, ...tried]) {
        const id = `${entry.remark}.${entry.step}.${entry.part}`;
        const piece = pieces.get(id) ?? 0;
        pieces.set(id, piece + 1);
        named.set(entry, {
            ...entry,
            call: { ...entry.call, id: piece === 0 ? id : `${id}.${piece}` },
        });
    }

    return {
        calls: [...named.values()],
        byHand: remaining,
        displaced: displaced.map((one) => ({
            ...one,
            by: one.by.map((entry) => named.get(entry)!),
        })),
        gaveWay,
    };
};
