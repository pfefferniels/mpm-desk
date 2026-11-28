/**
 * One run of a document for the describe desk.
 *
 * The document holds three kinds of call: the remarks (`Describe`), the calls a remark's steps
 * resolved to the last time they were resolved, and the calls made by hand on other desks. The
 * second kind is passed over, being derived: the steps are resolved again, against the recording
 * and against one another, and what they come to is handed back to be written in its place. The
 * third kind runs as it stands.
 *
 * Where `runFit` refuses a chain, this leaves a call out and says why, a step at a time: a reader
 * describing a piece bit by bit is never without a rendering.
 *
 * ## A remark and the calls made by hand
 *
 * Where a remark speaks of a place a call made by hand speaks of too, one of the two gives way,
 * as an earlier remark gives way to a later one (`settle.ts`), and which is the reader's to say:
 *
 * - **On trial**, the remark is later than every call made by hand. Its steps take their place,
 *   the run is the document as it would stand after that, and the remark's report names what
 *   it displaces ({@link RemarkReport.displaced}) with what is left of each. Nothing is taken
 *   from the document by that: it is what the reader is asked about.
 * - **Written**, a remark is earlier than the calls made by hand that still stand in its place:
 *   they were made after it, or kept when it was written. Its steps are cut round them
 *   ({@link StepReport.gaveWayTo}), and one that is left with nothing says so
 *   ({@link StepReport.behind}).
 *
 * So a remark tried and then written without what it displaces being taken out comes out cut
 * round those calls; that is "keep". "Replace" is one edit of the document, from the run of the
 * trial: with `tried` the remark on trial's report,
 *
 * ```ts
 * replaceCalls(
 *     [
 *         ...(tried.displaced ?? []).map(({ call }) => call.id),
 *         ...every `Describe` call's id, and every id one of them names in `calls`,
 *     ],
 *     [
 *         ...(tried.displaced ?? []).flatMap(({ left }) => left),
 *         ...run.remarks.flatMap((remark) => [
 *             the remark's `Describe` call, with `calls` the ids of `remark.concrete`,
 *             ...remark.concrete,
 *         ]),
 *     ],
 * );
 * ```
 *
 * in that order: what is left of the calls made by hand, then every remark with what it resolved
 * to. A remark new to the document is given a `date` later than every other's, as it was last on
 * trial. A plain run of the document so written resolves every remark to the same calls and
 * displaces nothing, and the Desk's own chain makes the same MPM of it, less what was assumed.
 */
import { Alignment } from '../alignment';
import { buildChain } from '../chain';
import { createMpm, exportMPM } from '../instructions/index';
import { clearResidualCache, deriveResidual, type Residual } from '../residual';
import type { DescribeOptions } from '../transformers/description/Describe';
import { validate } from '../transformers/Order';
import type { Transformer } from '../transformers/Transformer';
import { parseWorkFile, serializeWorkFile, type Call } from '../../model/Work';
import { assume, AssumeLevel, AssumeTempo, levelOf, STANDS_FOR } from './assume';
import { expand, rolledBy, type Step } from './expand';
import { silently, type Sounded } from './perform';
import { layRoll, soundOf, type Assumed, type Roll } from './roll';
import {
    DYNAMICS,
    everywhere,
    settle,
    TEMPO,
    type Displaced,
    type Places,
    type StepCall,
} from './settle';
import { FitDynamics, FitTempo } from './steps';

/** What one step of a remark came to in a run. */
export interface StepReport {
    /** The ids of the calls it resolved to, among its remark's `concrete`. */
    calls: string[];
    /** The ids of the MPM elements it wrote. */
    elements: string[];
    /** The start tag of each element, parallel to `elements`; empty for one since removed. */
    written: string[];
    /** The definitions those elements refer to, each in full. */
    definitions: string[];
    /** The ids of the notes, or of the recorded presses, it was fitted to. */
    evidence: string[];
    /** What a fitted step read off the recording, a line for each call it came to. */
    fitted: Record<string, unknown>[];
    /** The stretch of score it acted on, in ticks; null where it names no place. */
    range: { from: number; to: number | null } | null;
    /**
     * Why it, or one of the calls it was written out as, could not run. What could not run is
     * left out, and the rest still run.
     */
    error?: string;
    /**
     * Why calls of it that ran here are kept out of `concrete`: the Desk's own chain would refuse
     * the document holding them, for want of something this run only assumed; or they wrote
     * nothing, what they say being said in their place already.
     */
    withheld?: string;
    /**
     * On trial, where it takes the place of calls made by hand: their ids. What becomes of each
     * is in the remark's `displaced`.
     */
    displaces?: string[];
    /**
     * Where it gave way to calls made by hand, being cut round them or left out: their ids.
     */
    gaveWayTo?: string[];
    /**
     * Where giving way left nothing of the step: what it stands behind, in words. That is no
     * error, and it comes to no call until what stands in its place is gone.
     */
    behind?: string;
}

/** What one remark came to in a run. */
export interface RemarkReport {
    /** The id of its `Describe` call. */
    id: string;
    /**
     * The plain Desk calls its steps resolve to, ready to be written into the document. Named
     * after the remark, the step and the call's place in it (`${id}.${step}.${part}`), so that a
     * run of the same document names them alike.
     */
    concrete: Call[];
    /** Per step, in the order of `Describe.options.steps`. */
    steps: StepReport[];
    /**
     * On the remark on trial, where calls made by hand stand in its place: each of them as the
     * document holds it, with what is left of it, to be put in its place (none where it goes
     * entirely). Absent on every other remark, and where nothing made by hand stands in the way.
     *
     * A remainder keeps the call's id, and a second one is `${id}.1` (or the next id the
     * document has free), so the same trial names them alike each time it is run.
     */
    displaced?: Displaced[];
}

export interface DescriptionRun {
    /**
     * The MPM of this run: the document's calls, the remarks' steps, and what is assumed where
     * nothing is described.
     */
    mpm: string;
    /** The score that MPM is rendered against, as MSM. With `mpm`, what `bringOut` takes. */
    score: string;
    roll: Roll;
    /** Per `Describe` call of the document, in document order; a new remark on trial comes last. */
    remarks: RemarkReport[];
    /** Problems that belong to no step. */
    problems: string[];
}

export interface DescribeRunOptions {
    /**
     * Steps tried in place of one remark's for this run alone. A remark the document does not
     * hold is taken for a new one, made after every other. The remark on trial takes the place
     * of the calls made by hand it stands over; see the head of this file.
     */
    trial?: { remark: string; steps: DescribeOptions['steps'] };
}

const DESCRIBE = 'Describe';

/** The calls that edit the recording by hand. What is read off the recording is read after them. */
const GROUND = new Set(['ProcessVoices', 'MakeChoice', 'CorrectPedal', 'Modify']);
/** Those of them that correct what was played: with them applied, the recording is "as played". */
const CORRECTIONS = new Set(['CorrectPedal', 'Modify']);

const TEMPO_CALLS = new Set(['AssumeTempo', ...TEMPO]);

interface Remark {
    id: string;
    /** When it was made, in ms; a remark without a date was made before every dated one. */
    date: number;
    steps: Step[];
}

const stepsOf = (value: unknown): Step[] =>
    (Array.isArray(value) ? value : []).flatMap((step: Partial<Step> | null) =>
        typeof step?.name === 'string' ? [{ name: step.name, options: step.options ?? {} }] : [],
    );

/** Steps with their `Map`s and `Set`s as a chain takes them, however they were written down. */
const revived = (steps: Step[]): Step[] =>
    parseWorkFile(
        serializeWorkFile({
            name: '',
            mei: '',
            mpm: '',
            provenance: steps.map((step, index) => ({ id: String(index), ...step })),
        }),
    ).provenance;

/** The document as remarks and as the calls made by hand; what a remark owns is passed over. */
const read = (calls: readonly Call[], trial: DescribeRunOptions['trial']) => {
    const remarks = calls
        .filter((call) => call.name === DESCRIBE)
        .map((call): Remark => {
            const made =
                typeof call.options['date'] === 'string' ? Date.parse(call.options['date']) : NaN;
            return {
                id: call.id,
                date: Number.isNaN(made) ? -Infinity : made,
                steps: stepsOf(call.options['steps']),
            };
        });
    const owned = new Set(
        calls
            .filter((call) => call.name === DESCRIBE)
            .flatMap((call): unknown[] =>
                Array.isArray(call.options['calls']) ? call.options['calls'] : [],
            ),
    );
    const byHand = calls.filter((call) => call.name !== DESCRIBE && !owned.has(call.id));

    if (trial) {
        const tried = remarks.find((remark) => remark.id === trial.remark);
        if (tried) tried.steps = stepsOf(trial.steps);
        else remarks.push({ id: trial.remark, date: Infinity, steps: stepsOf(trial.steps) });
    }
    return {
        remarks: remarks.map((remark) => ({ ...remark, steps: revived(remark.steps) })),
        byHand,
    };
};

/**
 * The chain with the calls of one family in score order among themselves.
 *
 * The registry runs every fitted step before the first of the calls they make. But a tempo is
 * measured from where the one before it ends, and a document holds the made calls, which the
 * Desk runs by their dates: so here they run by their dates too, where two share one in the order
 * `position` gives.
 */
const inScoreOrder = (
    chain: readonly Transformer[],
    family: ReadonlySet<string>,
    position: (transformer: Transformer) => number,
): Transformer[] => {
    const from = ({ options }: Transformer) => {
        const stated = (options as { from?: unknown }).from;
        return typeof stated === 'number' ? stated : 0;
    };
    const members = chain
        .filter((transformer) => family.has(transformer.name))
        .sort((a, b) => from(a) - from(b) || position(a) - position(b));
    let next = 0;
    return chain.map((transformer) =>
        family.has(transformer.name) ? members[next++]! : transformer,
    );
};

/**
 * The start tag of every element with an `xml:id`, the ids more than one element goes by, and
 * every definition by its name.
 */
const elementsOf = (xml: string) => {
    const tags = new Map<string, string>();
    const twice = new Set<string>();
    for (const [tag, , id] of xml.matchAll(
        /<[\w.:-]+(\s+[\w.:-]+="[^"]*")*?\s+xml:id="([^"]+)"[^>]*>/g,
    )) {
        if (tags.has(id!)) twice.add(id!);
        tags.set(id!, tag);
    }
    const definitions = new Map<string, string>();
    for (const [definition, , name] of xml.matchAll(
        /<((?!style)\w+Def)\b[^>]*?\sname="([^"]+)"[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g,
    )) {
        definitions.set(name!, definition);
    }
    return { tags, definitions, twice };
};

/** The plain Desk calls a call of a step came to when it ran, and what it read off the recording. */
const madeBy = (
    transformer: Transformer,
    { call, remark, step, part }: StepCall,
    pieces: number,
): { calls: Call[]; fitted?: Record<string, unknown> } => {
    const { id } = call;
    if (transformer instanceof FitTempo) {
        if (!transformer.fitted) return { calls: [] };
        const { rmsMs, onsets, ...options } = transformer.fitted;
        const calls = [{ id, name: 'InsertTempo', options }];
        // One more call of the part, numbered after the pieces a cut left of it.
        if (transformer.closing) {
            calls.push({
                id: `${remark}.${step}.${part}.${pieces}`,
                name: 'InsertTempo',
                options: { ...transformer.closing },
            });
        }
        return { calls, fitted: { ...options, rmsMs, onsets } };
    }
    if (transformer instanceof FitDynamics) {
        if (!transformer.fitted) return { calls: [] };
        const { call: made, volume, chords } = transformer.fitted;
        return {
            calls: [{ id, name: 'InsertDynamics', options: { ...made } }],
            fitted: { ...transformer.options, volume, chords },
        };
    }
    return { calls: [call] };
};

/** Where a call that ran acted and what it was fitted to, added to its step's report. */
const locate = (
    report: StepReport,
    transformer: Transformer,
    piece: Alignment,
    residual: Residual | undefined,
) => {
    try {
        report.evidence.push(...transformer.evidence(piece, residual));
        const range = transformer.range(piece, residual);
        if (!range) return;
        const to = range.to ?? null;
        report.range = report.range
            ? {
                  from: Math.min(report.range.from, range.from),
                  to: Math.max(report.range.to ?? report.range.from, to ?? range.from),
              }
            : { from: range.from, to };
    } catch {
        // A call can run and still not say where: its place is then left unsaid.
    }
};

/** Why a call of the remark on trial came to nothing: it could not run, or wrote nothing. */
interface Idle {
    why: string;
    as: 'error' | 'withheld';
}

/**
 * One run; see {@link describe}.
 *
 * @param idle calls of the remark on trial that are left out of this run, by `${step}.${part}`,
 * each with what its step is to say of it.
 * @returns the run, and the calls of the remark on trial that took the place of calls made by
 * hand in it and then came to nothing.
 */
const resolve = (
    alignment: Alignment,
    calls: readonly Call[],
    trial: DescribeRunOptions['trial'],
    idle: ReadonlyMap<string, Idle>,
): { run: DescriptionRun; undone: Map<string, Idle> } => {
    clearResidualCache();
    const { remarks, byHand } = read(calls, trial);
    const reports = new Map(
        remarks.map((remark) => [
            remark.id,
            remark.steps.map((): StepReport => ({
                calls: [],
                elements: [],
                written: [],
                definitions: [],
                evidence: [],
                fitted: [],
                range: null,
            })),
        ]),
    );
    const reportOf = ({ remark, step }: { remark: string; step: number }) =>
        reports.get(remark)![step]!;
    const problems: string[] = [];

    /** The calls the steps came to, by their ids; those that could not run; those that wrote none. */
    const origin = new Map<string, StepCall>();
    const stopped = new Map<StepCall, string>();
    const mute = new Map<StepCall, string>();
    const silent = new Map<StepReport, string>();
    const blame = (id: string, name: string, message: string) => {
        const entry = origin.get(id);
        if (!entry) {
            problems.push(`${name}: ${message}`);
            return;
        }
        stopped.set(entry, message);
        reportOf(entry).error ??= message;
    };

    // The later remark owns its place, so the steps are written out in the order they were made.
    const made = [...remarks].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const steps = made.flatMap((remark) =>
        remark.steps.map((source, step) => ({ remark: remark.id, step, source })),
    );
    const writeOut = (some: typeof steps, piece: Alignment): StepCall[] =>
        some.flatMap(({ remark, step, source }) => {
            const expanded = expand(source, `${remark}.${step}`, piece);
            if (typeof expanded === 'string') {
                reportOf({ remark, step }).error = expanded;
                return [];
            }
            const general = everywhere(source);
            return expanded.flatMap(({ part, call }) => {
                const out = remark === trial?.remark ? idle.get(`${step}.${part}`) : undefined;
                if (out?.as === 'error') reportOf({ remark, step }).error ??= out.why;
                if (out?.as === 'withheld') silent.set(reportOf({ remark, step }), out.why);
                return out ? [] : [{ call, remark, step, part, ...(general && { general }) }];
            });
        });
    const corrects = ({ source }: (typeof steps)[number]) => {
        const repeated =
            source.name === 'Repeat'
                ? (source.options['call'] as Partial<Step> | undefined)?.name
                : undefined;
        return CORRECTIONS.has(repeated ?? source.name);
    };

    const piece = alignment.deepClone();
    const mpm = createMpm();
    const ran: Transformer[] = [];
    const attempt = (transformer: Transformer) => {
        try {
            silently(() => transformer.run(piece, mpm));
            ran.push(transformer);
        } catch (thrown) {
            blame(
                transformer.id,
                transformer.name,
                thrown instanceof Error ? thrown.message : String(thrown),
            );
        }
    };

    // First the hand's own edits of the recording, the remarks' among them. What a step is
    // written out as depends on where a chord sounds, and that is asked of the recording as played.
    const corrections = writeOut(steps.filter(corrects), piece);
    for (const entry of corrections) origin.set(entry.call.id, entry);
    /** In the order of the document, which is the order the calls stand in once they are written. */
    const ofRemarks = (entries: StepCall[]) =>
        remarks.flatMap((remark) =>
            entries.filter((entry) => entry.remark === remark.id).sort((a, b) => a.step - b.step),
        );
    const ground = buildChain([
        ...byHand.filter((call) => GROUND.has(call.name)),
        ...ofRemarks(corrections).map((entry) => entry.call),
    ]).transformers.filter((transformer) => GROUND.has(transformer.name));

    let arrived: Map<string, Sounded> | undefined;
    const sounding = () => new Map(piece.allNotes.map((note) => [note['xml:id'], soundOf(note)]));
    for (const transformer of ground) {
        if (CORRECTIONS.has(transformer.name)) arrived ??= sounding();
        attempt(transformer);
    }
    arrived ??= sounding();

    const unchosen = piece.unchosenNotes();
    if (unchosen > 0) {
        throw new Error(
            `${unchosen} notes still stand on more than one reading: ` +
                'choose the take to read before describing it',
        );
    }
    const played = piece.deepClone();

    // The chain moves the first onset to 0. How far is kept, to lay the playing on the same clock.
    let shifted = 0;
    const shift = piece.shiftToFirstOnset.bind(piece);
    piece.shiftToFirstOnset = () => {
        const earliest = piece.allNotes.reduce(
            (min, note) =>
                Number.isFinite(note['milliseconds.date'])
                    ? Math.min(min, note['milliseconds.date'])
                    : min,
            Infinity,
        );
        if (Number.isFinite(earliest)) shifted += earliest;
        shift();
    };

    // The remarks' steps against one another and against what was made by hand: on trial a
    // remark takes the place of those calls, written it stands behind them.
    const rolls = new Map<Call, Set<number>>();
    const places: Places = {
        dates: [...new Set(played.allNotes.map((note) => note.date))].sort((a, b) => a - b),
        rolled: (call) => rolls.get(call) ?? rolls.set(call, rolledBy(call, played)).get(call)!,
    };
    const settled = settle(
        writeOut(
            steps.filter((step) => !corrects(step)),
            played,
        ),
        byHand.filter((call) => !GROUND.has(call.name)),
        trial?.remark,
        new Set(calls.map((call) => call.id)),
        places,
    );
    const described = settled.calls;
    for (const entry of described) origin.set(entry.call.id, entry);
    const derived = ofRemarks([...corrections, ...described]);

    for (const { call, by } of settled.displaced) {
        for (const entry of by) (reportOf(entry).displaces ??= []).push(call.id);
    }
    const stoodOver = Map.groupBy(settled.gaveWay, ({ entry }) => reportOf(entry));
    for (const [report, gave] of stoodOver) {
        const { remark, step } = gave[0]!.entry;
        const to = [...new Set(gave.flatMap((one) => one.to))];
        report.gaveWayTo = to.map((call) => call.id);
        if (described.some((left) => left.remark === remark && left.step === step)) continue;
        const names = [...Map.groupBy(to, (call) => call.name)].map(
            ([name, named]) => `${name} ×${named.length}`,
        );
        report.behind = `stands behind what was made by hand in its place: ${names.join(', ')}`;
    }

    const standing = [
        ...settled.byHand,
        ...derived.filter((entry) => !GROUND.has(entry.call.name)).map((entry) => entry.call),
    ];
    const assumptions = assume(standing, played);
    const built = buildChain([...assumptions, ...standing]);
    for (const call of built.unknown)
        blame(call.id, call.name, `There is no transformer called ${call.name}`);

    // What is assumed goes first where two calls share a date, and is written over.
    const position = new Map([...assumptions, ...standing].map((call, at) => [call.id, at]));
    const placed = (transformer: Transformer) => position.get(transformer.id) ?? 0;
    const ordered = inScoreOrder(
        inScoreOrder(built.transformers, TEMPO_CALLS, placed),
        DYNAMICS,
        placed,
    );

    // A call whose `requires` nothing before it meets is left out, as is every call of a step
    // that has already failed.
    const unmet = new Set<Transformer>();
    const done = new Set(ran.map((transformer) => transformer.name));
    for (const transformer of ordered) {
        for (const Required of transformer.requires) {
            const needed = new Required().name;
            if (done.has(needed)) continue;
            unmet.add(transformer);
            blame(
                transformer.id,
                transformer.name,
                `${transformer.name} needs a ${needed} before it, and nothing described so far makes one`,
            );
        }
        done.add(STANDS_FOR.get(transformer.name) ?? transformer.name);
    }
    const failed = (transformer: Transformer) => {
        const entry = origin.get(transformer.id);
        return (
            unmet.has(transformer) || (entry !== undefined && reportOf(entry).error !== undefined)
        );
    };
    for (const transformer of ordered.filter((candidate) => !failed(candidate)))
        attempt(transformer);

    const xml = exportMPM(mpm);
    const score = silently(() => piece.serializeScore());
    let residual: Residual | undefined;
    try {
        residual = silently(() => deriveResidual(piece, mpm, { without: ['movement'] }));
    } catch (thrown) {
        problems.push(thrown instanceof Error ? thrown.message : String(thrown));
    }

    const level = ran.find(
        (transformer): transformer is AssumeLevel => transformer instanceof AssumeLevel,
    );
    const assumed: Assumed = {
        tempo: ran
            .filter((transformer): transformer is AssumeTempo => transformer instanceof AssumeTempo)
            .map(({ options, bpm }) => ({ from: options.from, to: options.to, bpm: bpm ?? NaN })),
        level: level?.level ?? null,
        levelDates: level?.options.dates ?? [],
    };
    const roll = silently(() =>
        layRoll({
            fitted: piece,
            played,
            arrived,
            shifted,
            mpm,
            xml,
            score,
            assumed,
            level: level?.level ?? levelOf(piece),
        }),
    );

    // What each call that ran wrote, and the plain Desk calls it came to.
    const pieces = Map.groupBy(described, ({ remark, step, part }) => `${remark}.${step}.${part}`);
    const concrete = new Map<string, Call[]>();
    for (const transformer of ran) {
        const entry = origin.get(transformer.id);
        if (!entry) continue;
        const report = reportOf(entry);
        report.elements.push(...transformer.created);
        silently(() => locate(report, transformer, piece, residual));

        const base = `${entry.remark}.${entry.step}.${entry.part}`;
        const { calls: made, fitted } = madeBy(transformer, entry, pieces.get(base)?.length ?? 1);
        if (fitted) report.fitted.push(fitted);
        concrete.set(entry.call.id, made);
    }

    // Nothing is handed over that says nothing: a call whose business is an instruction, and
    // which left none in the document, found its place spoken for. Nor one whose element goes by
    // an id another element has, which two calls describing one thing come to.
    const { tags, definitions, twice } = elementsOf(xml);
    if (twice.size > 0) {
        problems.push(
            `${twice.size} elements of the MPM share their xml:id with another ` +
                `(${[...twice].slice(0, 3).join(', ')}): two calls describe the same thing`,
        );
    }
    for (const transformer of ran) {
        const entry = origin.get(transformer.id);
        if (!entry || !/^(Insert|Fit)/.test(transformer.name)) continue;
        const shared = transformer.created.find((id) => twice.has(id));
        if (shared !== undefined) {
            mute.set(
                entry,
                `${transformer.name} wrote ${shared}, which another call wrote as well`,
            );
            reportOf(entry).withheld ??= mute.get(entry);
        } else if (transformer.created.some((id) => tags.has(id))) {
            continue;
        } else {
            mute.set(
                entry,
                `${transformer.name} wrote nothing: what it says is said in its place already`,
            );
            silent.set(reportOf(entry), mute.get(entry)!);
        }
        concrete.delete(entry.call.id);
    }

    // Nor anything the Desk's own chain would refuse: a requirement this run met with an
    // assumption is not met in the document, and `runFit` throws on the whole of it.
    const kept = [...byHand.filter((call) => GROUND.has(call.name)), ...settled.byHand];
    for (;;) {
        const handed = derived.flatMap((entry) => concrete.get(entry.call.id) ?? []);
        const { transformers } = buildChain([...kept, ...handed]);
        const refused = new Map(
            validate(transformers).map(({ index, message }) => [transformers[index]!.id, message]),
        );
        const withheld = derived.filter((entry) =>
            concrete.get(entry.call.id)?.some((call) => refused.has(call.id)),
        );
        if (withheld.length === 0) break;
        for (const entry of withheld) {
            const reason = concrete
                .get(entry.call.id)!
                .map((call) => refused.get(call.id))
                .find(Boolean);
            reportOf(entry).withheld ??= `${reason}, and this run only assumed one`;
            concrete.delete(entry.call.id);
        }
    }

    for (const entry of derived) {
        reportOf(entry).calls.push(...(concrete.get(entry.call.id) ?? []).map((call) => call.id));
    }
    for (const report of [...reports.values()].flat()) {
        // Said only where the step comes to nothing by it: a press that cannot be placed, among
        // the presses of a step that traces them all, is passed over as an unrolled chord is.
        if (report.calls.length === 0 && !report.error && !report.behind) {
            report.withheld ??= silent.get(report);
        }
        if (report.displaces) report.displaces = [...new Set(report.displaces)];
        report.elements = [...new Set(report.elements)];
        report.written = report.elements.map((id) => tags.get(id) ?? '');
        const named = report.written.map((tag) => /\sname\.ref="([^"]+)"/.exec(tag)?.[1]);
        report.definitions = [
            ...new Set(named.flatMap((name) => definitions.get(name ?? '') ?? [])),
        ];
        report.evidence = [...new Set(report.evidence)];
    }

    const undone = new Map<string, Idle>();
    for (const entry of new Set(settled.displaced.flatMap(({ by }) => by))) {
        const why = stopped.get(entry) ?? mute.get(entry);
        if (why === undefined) continue;
        undone.set(`${entry.step}.${entry.part}`, {
            why,
            as: stopped.has(entry) ? 'error' : 'withheld',
        });
    }

    const run = {
        mpm: xml,
        score: score ?? '',
        roll,
        remarks: remarks.map(({ id }) => ({
            id,
            concrete: derived
                .filter((entry) => entry.remark === id)
                .flatMap((entry) => concrete.get(entry.call.id) ?? []),
            steps: reports.get(id)!,
            ...(id === trial?.remark &&
                settled.displaced.length > 0 && {
                    displaced: settled.displaced.map(({ call, left }) => ({ call, left })),
                }),
        })),
        problems,
    };
    return { run, undone };
};

/**
 * Run a document's calls and its remarks' steps over an alignment.
 *
 * @param alignment the recording as it was loaded; it is copied, never written through.
 * @param calls the document's calls as they stand.
 * @throws where the readings still stand side by side: nothing can be read off a recording
 * that has not been chosen.
 */
export const describe = (
    alignment: Alignment,
    calls: readonly Call[],
    { trial }: DescribeRunOptions = {},
): DescriptionRun => {
    // A call of the remark on trial that takes the place of calls made by hand and then cannot
    // run, or writes nothing, would leave their place empty. The run is made again without it:
    // what it would have displaced stands, and its step says why it came to nothing.
    const idle = new Map<string, Idle>();
    for (;;) {
        const { run, undone } = resolve(alignment, calls, trial, idle);
        if (undone.size === 0) return run;
        for (const [part, why] of undone) idle.set(part, why);
    }
};
