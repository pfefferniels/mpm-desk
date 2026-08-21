/**
 * Reading `performance.mpm` for display, over espressivo's object model.
 *
 * This replaces what `mpm-ts` did for the viewer: parse once, take an inventory of every
 * dated instruction, and answer "what is in effect at this tick?" while the playhead moves.
 * The two instruction charts get their numbers from here too.
 *
 * **The numbers are the renderer's.** `getTempoDataOf` / `getDynamicsDataOf` and the
 * `tempoAt` / `dynamicsAt` evaluators are the same code paths `renderExpressiveMidi` runs,
 * so a chart drawn from them cannot disagree with what is heard. espressivo's
 * `docs/reading.md` is the guide; three of its cautions are load-bearing here:
 *
 *  - A trailing transition is inert — the last instruction of a map has an `endDate` of
 *    `Number.MAX_VALUE`, so it never leaves its start value however its `@transition.to`
 *    reads. The views ask `tempoAt`/`dynamicsAt` for both endpoint labels rather than
 *    printing `@transition.to`, which is what makes them tell the truth about it.
 *  - A skipped instruction resolves to null and is *not* an extension of the previous one.
 *    Here that means no chart, not a held value.
 *  - An unresolvable name is a number, not an absence: `Dynamics.volume` is always finite.
 *
 * Two more from the same guide shape this file's boundaries: these objects hold live XML
 * nodes, so nothing here may cross a worker boundary (it doesn't — playback is synchronous
 * on the main thread), and `new Mpm(text)` normalizes as it parses, so this is a reader and
 * never a round trip.
 */
import {
    DynamicsMap,
    MetricalAccentuationMap,
    Mpm,
    RubatoMap,
    TempoMap,
    dynamicsAt,
    tempoAt,
    type Dynamics,
    type GenericMap,
    type Tempo,
} from 'espressivo';
import type { Meter } from './score';

/** One dated instruction of the performance, as the viewer refers to it. */
export interface Instruction {
    /**
     * `@xml:id`. The viewer's whole selection model is keyed by it — a segment names the MPM
     * elements it is made of — which is sound here because these documents are generated with
     * an id on every instruction (`scripts/verifySegments.ts` checks all 574 of them resolve).
     * MPM does not require ids in general, so a reader for arbitrary MPM would want
     * `(map, index)` as its locator instead; both are on this record.
     */
    id: string;
    /** Element local name: `tempo`, `dynamics`, `accentuationPattern`, … */
    type: string;
    date: number;
    /** The map it lives in, and where in it — together, what the resolvers take. */
    map: GenericMap;
    index: number;
}

/** An instruction with the ones on either side of it, for a chart that shows context. */
export interface Neighbourhood<T> {
    focused: T;
    previous: T | null;
    next: T | null;
}

/**
 * Types that stay in force until the next instruction of their kind replaces them.
 * The rest either occupy a bounded span (`rubato`, `accentuationPattern`) or act only on
 * the notes at their own date (`articulation`, `asynchrony`, `ornament`).
 */
const UNBOUNDED = new Set(['tempo', 'dynamics', 'movement']);

export interface PerformanceReader {
    /** Every dated instruction, in document order, style switches excluded. */
    readonly instructions: readonly Instruction[];
    /** The grid the dates are in — carried along so a chart need not be handed it twice. */
    readonly meter: Meter;
    byId(id: string): Instruction | undefined;
    /**
     * The instructions of `type` in force at `date` — what the stack lights up as the
     * playhead passes. Anything placed exactly at `date` counts, plus the last one at or
     * before it where that type's span rule says it still reaches.
     */
    effectiveAt(date: number, type: string): Instruction[];
    /** The resolved `<tempo>` for `instruction`, with its neighbours; null if unreadable. */
    tempoAround(instruction: Instruction): Neighbourhood<Tempo> | null;
    /** The resolved `<dynamics>` for `instruction`, with its neighbours. */
    dynamicsAround(instruction: Instruction): Neighbourhood<Dynamics> | null;
}

export const readPerformance = (mpmXml: string, meter: Meter): PerformanceReader => {
    const performance = new Mpm(mpmXml).getPerformance(0);

    const instructions: Instruction[] = [];
    const byId = new Map<string, Instruction>();
    const byType = new Map<string, Instruction[]>();
    /** The instructions sharing one map and one element name, in index order. */
    const siblings = new Map<Instruction, Instruction[]>();

    const environments = performance
        ? [performance.getGlobal(), ...performance.getAllParts()]
        : [];

    for (const environment of environments) {
        for (const map of environment?.getDated()?.getAllMaps().values() ?? []) {
            const byLocalName = new Map<string, Instruction[]>();

            map.getAllElements().forEach(({ key: date, value: element }, index) => {
                const type = element.getLocalName();
                // A map holds `<style>` switches as dated entries too; they are not
                // instructions and carry none of what follows.
                if (type === 'style') return;
                const id = element.getAttributeValue('id');
                if (id === null || !Number.isFinite(date)) return;

                const instruction: Instruction = { id, type, date, map, index };
                instructions.push(instruction);
                byId.set(id, instruction);

                const ofType = byType.get(type);
                if (ofType) ofType.push(instruction);
                else byType.set(type, [instruction]);

                const group = byLocalName.get(type);
                if (group) group.push(instruction);
                else byLocalName.set(type, [instruction]);
            });

            for (const group of byLocalName.values()) {
                for (const instruction of group) siblings.set(instruction, group);
            }
        }
    }

    // espressivo re-sorts every map by date as it parses, so this is defensive rather than
    // corrective — but `effectiveAt` walks these in order and would be wrong without it.
    for (const list of byType.values()) list.sort((a, b) => a.date - b.date);

    /** The last instruction of `list` at or before `date`. */
    const ongoingAt = (list: readonly Instruction[], date: number) => {
        let found: Instruction | undefined;
        for (const instruction of list) {
            if (instruction.date > date) break;
            found = instruction;
        }
        return found;
    };

    /**
     * Does the `<accentuationPattern>` at `instruction` still cover `date`?
     *
     * espressivo's rule (`MetricalAccentuationMap.ts:167`), both halves: the next pattern
     * bounds the span regardless of length or loop, and `@length` is counted in beats
     * relative to the time-signature denominator rather than in ticks.
     */
    const accentuationCovers = (instruction: Instruction, date: number) => {
        const { map, index } = instruction;
        if (!(map instanceof MetricalAccentuationMap)) return false;
        const accentuation = map.getMetricalAccentuationDataOf(index);
        if (!accentuation || date >= accentuation.endDate) return false;
        if (accentuation.loop) return true;
        const length = accentuation.accentuationPatternDef?.getLength();
        if (length === undefined || length === null) return false;
        return date < accentuation.startDate + (length * 4 * meter.ppq) / meter.denominator;
    };

    /** Does the `<rubato>` at `instruction` still cover `date`? */
    const rubatoCovers = (instruction: Instruction, date: number) => {
        const { map, index } = instruction;
        if (!(map instanceof RubatoMap)) return false;
        const rubato = map.getRubatoDataOf(index);
        if (!rubato) return false;
        return rubato.loop || date < rubato.startDate + rubato.frameLength;
    };

    const around = <T>(
        instruction: Instruction,
        resolve: (instruction: Instruction) => T | null,
    ): Neighbourhood<T> | null => {
        const focused = resolve(instruction);
        if (focused === null) return null;

        const group = siblings.get(instruction) ?? [instruction];
        const at = group.indexOf(instruction);
        return {
            focused,
            previous: at > 0 ? resolve(group[at - 1]) : null,
            next: at >= 0 && at < group.length - 1 ? resolve(group[at + 1]) : null,
        };
    };

    return {
        instructions,
        meter,

        byId: id => byId.get(id),

        effectiveAt: (date, type) => {
            const list = byType.get(type);
            if (!list) return [];

            const result = list.filter(instruction => instruction.date === date);

            const ongoing = ongoingAt(list, date);
            if (!ongoing || result.includes(ongoing)) return result;

            const covers = UNBOUNDED.has(type)
                ? true
                : type === 'rubato'
                    ? rubatoCovers(ongoing, date)
                    : type === 'accentuationPattern'
                        ? accentuationCovers(ongoing, date)
                        // articulation, asynchrony and ornament act on the notes at their
                        // own date and reach no further, so the exact matches above are all.
                        : false;

            if (covers) result.push(ongoing);
            return result;
        },

        tempoAround: instruction =>
            around(instruction, ({ map, index }) =>
                map instanceof TempoMap ? map.getTempoDataOf(index) : null),

        dynamicsAround: instruction =>
            around(instruction, ({ map, index }) =>
                map instanceof DynamicsMap ? map.getDynamicsDataOf(index) : null),
    };
};

/**
 * Where a chart should stop drawing an instruction that runs to the end of time.
 *
 * The last instruction of a map has no next one to close its span, so espressivo gives it
 * `Number.MAX_VALUE`. A chart needs a finite window; a quarter note is enough to show what
 * the instruction starts out doing, which — see the file header — is also all it ever does.
 */
export const spanEnd = (span: { startDate: number; endDate: number }, meter: Meter) =>
    span.endDate === Number.MAX_VALUE || !Number.isFinite(span.endDate)
        ? span.startDate + meter.ppq
        : span.endDate;

export { dynamicsAt, tempoAt };
export type { Dynamics, Tempo };
