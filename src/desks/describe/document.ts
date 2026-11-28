import type { DescriptionRun, Step } from '../../fitting/description/client';
import type { DescribedPlace } from '../../fitting/transformers/description/Describe';
import { serializeWorkFile, type Call } from '../../model/Work';

/**
 * The remarks as the document holds them, and every way the describe desk changes it.
 *
 * A remark is one `Describe` call: the words, the place, who turned them into steps and when, the
 * steps, and the ids of the plain Desk calls those steps resolve to. Those calls stand in the
 * document after it and are *derived*: a run resolves the steps again, and what they come to is
 * written in their place.
 *
 * Everything here is a function from the calls to an edit, `{ remove, add }`, which is what
 * `useWorkDocument().replaceCalls` takes: one step of undo, and none where nothing changed. An
 * edit always names **every** remark, in the order the document has them. `replaceCalls` puts
 * what it adds at the end, so writing one remark alone would move it behind the others, and
 * between remarks without a date the later one in the document owns a place both describe. It
 * also leaves the remarks where a run's result will be written, after every call made by hand,
 * so that the resolving that follows an edit finds nothing left to move.
 */

const DESCRIBE = 'Describe';

/** A remark as the document holds it. */
export interface Remark {
    /** The id of its `Describe` call. */
    id: string;
    text: string;
    about: DescribedPlace;
    /** The model that turned it into steps; null where nothing has yet, or a hand did. */
    model: string | null;
    /** When it was made, ISO 8601. */
    date: string | null;
    steps: Step[];
    /** The ids of the calls its steps resolved to the last time they were resolved. */
    calls: string[];
}

/** What `replaceCalls` takes. */
interface Edit {
    remove: string[];
    add: Call[];
}

const isDescribe = (call: Call): boolean => call.name === DESCRIBE;

const KINDS: readonly DescribedPlace['kind'][] = ['piece', 'span', 'notes', 'box', 'arrow'];

const placeOf = (value: unknown): DescribedPlace => {
    const stated = (value ?? {}) as Partial<DescribedPlace>;
    return {
        kind: KINDS.includes(stated.kind as DescribedPlace['kind']) ? (stated.kind as DescribedPlace['kind']) : 'piece',
        from: typeof stated.from === 'number' ? stated.from : 0,
        to: typeof stated.to === 'number' ? stated.to : 0,
        notes: Array.isArray(stated.notes) ? stated.notes.filter((id): id is string => typeof id === 'string') : [],
    };
};

const stepsOf = (value: unknown): Step[] =>
    (Array.isArray(value) ? value : []).flatMap((step: Partial<Step> | null) =>
        typeof step?.name === 'string' ? [{ name: step.name, options: step.options ?? {} }] : [],
    );

const ownedBy = (call: Call): string[] => {
    const owned = call.options['calls'];
    return Array.isArray(owned) ? owned.filter((id): id is string => typeof id === 'string') : [];
};

/** A `Describe` call read as a remark, whatever a file left out of it. */
const remarkOf = (call: Call): Remark => ({
    id: call.id,
    text: typeof call.options['text'] === 'string' ? call.options['text'] : '',
    about: placeOf(call.options['about']),
    model: typeof call.options['model'] === 'string' ? call.options['model'] : null,
    date: typeof call.options['date'] === 'string' ? call.options['date'] : null,
    steps: stepsOf(call.options['steps']),
    calls: ownedBy(call),
});

/**
 * What was made by hand on the other desks: the calls that are no remark and that no remark
 * owns.
 */
export const byHand = (calls: readonly Call[]): Call[] => {
    const owned = new Set(calls.filter(isDescribe).flatMap(ownedBy));
    return calls.filter((call) => !isDescribe(call) && !owned.has(call.id));
};

/** The remarks of a document, in its order. */
export const remarksOf = (calls: readonly Call[]): Remark[] => calls.filter(isDescribe).map(remarkOf);

/**
 * The document with the remarks of the prototype read as remarks are written now.
 *
 * DescribeIt saved a remark with the calls it had made and no steps. Such a remark resolves to
 * nothing, and what it owns is passed over on a run, so resolving it and writing the result back
 * would take its calls out of the document. Read here, they are its steps: what the prototype
 * wrote down as calls is what its expert had answered.
 */
export const migrated = (calls: readonly Call[]): readonly Call[] => {
    const byId = new Map(calls.map((call) => [call.id, call]));
    let changed = false;
    const read = calls.map((call) => {
        if (!isDescribe(call) || stepsOf(call.options['steps']).length > 0) return call;
        const owned = ownedBy(call).flatMap((id) => byId.get(id) ?? []);
        if (owned.length === 0) return call;
        changed = true;
        return { ...call, options: { ...call.options, steps: owned.map(({ name, options }) => ({ name, options })) } };
    });
    return changed ? read : calls;
};

/** The document with an expert's answer in place of what one remark became, not yet resolved. */
export const answered = (calls: readonly Call[], id: string, answer: { steps: readonly Step[]; model: string }): Call[] =>
    calls.map((call) =>
        call.id === id && isDescribe(call)
            ? { ...call, options: { ...call.options, model: answer.model, steps: [...answer.steps] } }
            : call,
    );

/**
 * What a run is a function of, as one string: the calls made by hand, and of each remark its
 * steps and its date. Not what a remark owns, which a run passes over, nor its words.
 *
 * Spelled as the work file's own writer spells a call, since options hold `Map`s and `Set`s.
 */
export const runKey = (calls: readonly Call[]): string => {
    const owned = new Set(calls.filter(isDescribe).flatMap(ownedBy));
    return serializeWorkFile({
        name: '',
        mei: '',
        mpm: '',
        provenance: calls
            .filter((call) => isDescribe(call) || !owned.has(call.id))
            .map(({ id, name, options }) =>
                name === DESCRIBE
                    ? { id, name, options: { date: options['date'] ?? null, steps: options['steps'] ?? [] } }
                    : { id, name, options },
            ),
    });
};

/** A new remark, as the document first holds it: the words and the place, and nothing they became. */
export const remarkCall = (id: string, text: string, about: DescribedPlace, date: string): Call => ({
    id,
    name: DESCRIBE,
    options: {
        text,
        // A passage and the piece are told by their stretch; only a set, a box and an arrow name notes.
        about: { ...about, notes: about.kind === 'span' || about.kind === 'piece' ? [] : [...about.notes] },
        model: null,
        date,
        steps: [],
        calls: [],
    },
});

/** Every remark of the document with what it owns, as an edit that leaves them as they stand. */
const standing = (calls: readonly Call[], each: (remark: Call, owned: Call[]) => Call[]): Edit => {
    const byId = new Map(calls.map((call) => [call.id, call]));
    const remarks = calls.filter(isDescribe);
    const ownedOf = (remark: Call) => ownedBy(remark).flatMap((id) => byId.get(id) ?? []);
    return {
        remove: remarks.flatMap((remark) => [remark.id, ...ownedOf(remark).map((call) => call.id)]),
        add: remarks.flatMap((remark) => each(remark, ownedOf(remark))),
    };
};

/**
 * What a run came to, written into the document: each remark with the ids of the calls its steps
 * resolved to, and those calls after it.
 *
 * @param calls the document the run was made of. Its remarks are written as they stand in it,
 * which is how an answer the document does not hold yet is written and resolved in one edit.
 */
export const resolved = (calls: readonly Call[], run: Pick<DescriptionRun, 'remarks'>): Edit => {
    const reports = new Map(run.remarks.map((report) => [report.id, report]));
    return standing(calls, (remark, owned) => {
        const report = reports.get(remark.id);
        // A remark the run says nothing of is kept as it is: its words are never lost to a run.
        if (!report) return [remark, ...owned];
        const { id, name, options } = remark;
        return [{ id, name, options: { ...options, calls: report.concrete.map((call) => call.id) } }, ...report.concrete];
    });
};

/** A call made by hand that an answer on trial takes the place of, with what is left of it. */
export type Displaced = NonNullable<DescriptionRun['remarks'][number]['displaced']>[number];

/** What an answer tried on the document would take the place of; none where it stands free. */
export const displacedBy = (run: Pick<DescriptionRun, 'remarks'>, id: string): readonly Displaced[] =>
    run.remarks.find((report) => report.id === id)?.displaced ?? [];

/**
 * An answer written from the run it was tried in, as one edit: the remark with its steps and
 * what they came to, and, where it takes the place of calls made by hand, those calls out and
 * what is left of them in.
 *
 * The order is the fitting's (`fitting/description/run.ts`): what is left of the calls made by
 * hand, then every remark with what it resolved to in that run. A plain run of the document so
 * written comes to the same calls and displaces nothing; and one step of undo brings back what
 * was made by hand, since it went in the same edit.
 *
 * @param calls the document the answer was tried on.
 * @param run the trial's run, with `id` the remark on trial.
 */
export const replaced = (
    calls: readonly Call[],
    id: string,
    answer: { steps: readonly Step[]; model: string },
    run: Pick<DescriptionRun, 'remarks'>,
): Edit => {
    const displaced = displacedBy(run, id);
    const { remove, add } = resolved(answered(calls, id, answer), run);
    return {
        remove: [...displaced.map(({ call }) => call.id), ...remove],
        add: [...displaced.flatMap(({ left }) => left), ...add],
    };
};

/** The document as an edit leaves it: what it takes out gone, what it puts in at the end. */
export const edited = (calls: readonly Call[], { remove, add }: Edit): Call[] => {
    const gone = new Set(remove);
    return [...calls.filter((call) => !gone.has(call.id)), ...add];
};

/** A remark made: the document's remarks as they stand, and the new one after them. */
export const made = (calls: readonly Call[], remark: Call): Edit => {
    const { remove, add } = standing(calls, (held, owned) => [held, ...owned]);
    return { remove, add: [...add, remark] };
};

/**
 * One remark said anew: its words changed, so what it became no longer stands for it, and the
 * calls it owned go.
 */
export const reworded = (calls: readonly Call[], id: string, change: { text: string; date: string }): Edit =>
    standing(calls, (remark, owned) =>
        remark.id === id
            ? [{ id: remark.id, name: remark.name, options: { ...remark.options, ...change, model: null, steps: [], calls: [] } }]
            : [remark, ...owned],
    );

/** One remark taken out, with everything it owns. */
export const removed = (calls: readonly Call[], id: string): Edit =>
    standing(calls, (remark, owned) => (remark.id === id ? [] : [remark, ...owned]));
