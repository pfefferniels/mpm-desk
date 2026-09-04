/**
 * Reading `performance.mpm` for display, over espressivo's object model.
 *
 * Parse once, take an inventory of every dated instruction, and answer "what is in effect at
 * this tick?" while the playhead moves. The instruction drawings get their numbers from here
 * too, and the card that quotes an instruction back gets the element and the `<…Def>` it
 * points at.
 *
 * **The numbers are the renderer's.** `getTempoDataOf` / `getDynamicsDataOf` and the
 * `tempoAt` / `dynamicsAt` evaluators are the code paths `renderExpressiveMidi` runs, so a chart
 * drawn from them cannot disagree with what is heard. Three cautions from espressivo's
 * `docs/reading.md` are load-bearing here:
 *
 *  - A trailing transition is inert: the last instruction of a map has an `endDate` of
 *    `Number.MAX_VALUE`, so it never leaves its start value however its `@transition.to` reads.
 *    The views ask `tempoAt`/`dynamicsAt` for both endpoint labels rather than printing
 *    `@transition.to`.
 *  - A skipped instruction resolves to null and is *not* an extension of the previous one, so it
 *    means no chart rather than a held value.
 *  - An unresolvable name is a number rather than an absence: `Dynamics.volume` is always
 *    finite.
 *
 * Two more from the same guide shape this file's boundaries: these objects hold live XML
 * nodes, so nothing here may cross a worker boundary (it doesn't — playback is synchronous
 * on the main thread), and `new Mpm(text)` normalizes as it parses, so this is a reader and
 * never a round trip.
 */
import {
    DEFAULT_CONTROLLER,
    DynamicsMap,
    MetricalAccentuationMap,
    MovementMap,
    Mpm,
    RubatoMap,
    TempoMap,
    dynamicsAt,
    positionAt,
    tempoAt,
    type Dynamics,
    type Element,
    type GenericMap,
    type Movement,
    type StyleKind,
    type Tempo,
} from 'espressivo';
import { beatTicksAt, type Meter } from './score';

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
    /**
     * The element itself, live in the parsed document.
     *
     * Carried so a reader can quote an instruction verbatim — `toXML()` is the same
     * serializer espressivo writes documents with — and so the odd attribute no resolved
     * record keeps (`@controller`) is still reachable. Nothing here writes to it.
     */
    element: Element;
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
    /**
     * The stretch over which `instruction` is what you hear — {@link effectiveAt} the other
     * way round, so the two always agree.
     *
     * From its own date to wherever its kind's span rule stops it: the next of its kind for
     * the types that hold until replaced, the end of its frame for a `<rubato>` and of its
     * pattern for an `<accentuationPattern>` unless either loops, and its own date for the
     * kinds that act only on the notes there — so `from` and `to` are equal for those. `to`
     * is `Infinity` for the last of an unbounded kind, which holds to the end of the piece;
     * where that is, the performance does not say.
     */
    reachOf(instruction: Instruction): { from: number; to: number };
    /** Every instruction of `type`, in date order — what a curve is sampled from. */
    ofType(type: string): readonly Instruction[];
    /** The resolved `<tempo>` for `instruction`, with its neighbours; null if unreadable. */
    tempoAround(instruction: Instruction): Neighbourhood<Tempo> | null;
    /** The resolved `<dynamics>` for `instruction`, with its neighbours. */
    dynamicsAround(instruction: Instruction): Neighbourhood<Dynamics> | null;
    /** The resolved `<tempo>` alone. */
    tempoOf(instruction: Instruction): Tempo | null;
    /** The resolved `<dynamics>` alone. */
    dynamicsOf(instruction: Instruction): Dynamics | null;
    /** The resolved `<movement>` — the pedal, or whatever controller it names. */
    movementOf(instruction: Instruction): Movement | null;
    /**
     * The `<…Def>` the instruction points at by name, resolved through the `<style>` in
     * force at its date; null where it names none or the name does not resolve.
     */
    defFor(instruction: Instruction): Element | null;
}

/**
 * Which style collection each instruction type looks its definition up in, and the
 * attribute that carries the name.
 *
 * `tempo` and `dynamics` are the odd pair: their name lives in the attribute that would
 * otherwise hold a number (`@bpm`, `@volume`), so a numeric value means there is no def to
 * find rather than a def named `59.15`.
 */
const STYLE_REF: Record<string, { kind: StyleKind; attribute: string }> = {
    tempo: { kind: 'tempo', attribute: 'bpm' },
    dynamics: { kind: 'dynamics', attribute: 'volume' },
    articulation: { kind: 'articulation', attribute: 'name.ref' },
    accentuationPattern: { kind: 'metricalAccentuation', attribute: 'name.ref' },
    rubato: { kind: 'rubato', attribute: 'name.ref' },
    ornament: { kind: 'ornamentation', attribute: 'name.ref' },
};

/**
 * The controller a `<movement>` drives, defaulted the way espressivo defaults it.
 *
 * No resolved record carries it — `Movement.controller` does, but the viewer needs it
 * before it resolves anything, to decide which movements belong on one lane.
 */
export const controllerOf = (instruction: Instruction): string =>
    instruction.element.getAttributeValue('controller') ?? DEFAULT_CONTROLLER;

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

                const instruction: Instruction = { id, type, date, map, index, element };
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
     * The date an instruction's own kind stops it at, regardless of what follows it.
     *
     * `Infinity` for the kinds that hold until the next of their kind replaces them, and for
     * a `<rubato>` or `<accentuationPattern>` that loops; its own date for the kinds that act
     * only on the notes there, and for an instruction espressivo cannot resolve. What the
     * *next* instruction does to the span is left to the caller, because the two callers
     * already know it differently: `effectiveAt` has picked the last one before its date,
     * `reachOf` looks the next one up.
     *
     * The `<accentuationPattern>` rule is espressivo's (`MetricalAccentuationMap.ts:167`),
     * both halves: `@length` is counted in the beats in force where the pattern begins rather
     * than in ticks, and the next pattern bounds the span regardless of length or loop
     * — `endDate` is that pattern's date, so it is kept here rather than trusted to the
     * caller's lookup.
     */
    const boundOf = (instruction: Instruction): number => {
        const { type, date, map, index } = instruction;
        if (UNBOUNDED.has(type)) return Infinity;

        if (type === 'rubato') {
            if (!(map instanceof RubatoMap)) return date;
            const rubato = map.getRubatoDataOf(index);
            if (!rubato) return date;
            return rubato.loop ? Infinity : rubato.startDate + rubato.frameLength;
        }

        if (type === 'accentuationPattern') {
            if (!(map instanceof MetricalAccentuationMap)) return date;
            const accentuation = map.getMetricalAccentuationDataOf(index);
            if (!accentuation) return date;
            if (accentuation.loop) return accentuation.endDate;
            const length = accentuation.accentuationPatternDef?.getLength();
            if (length === undefined || length === null) return date;
            return Math.min(
                accentuation.endDate,
                accentuation.startDate + length * beatTicksAt(meter, accentuation.startDate),
            );
        }

        // articulation, asynchrony and ornament act on the notes at their own date and reach
        // no further.
        return date;
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

            if (date < boundOf(ongoing)) result.push(ongoing);
            return result;
        },

        reachOf: instruction => {
            // The next of its kind in date order replaces it — even one on the same date,
            // which `ongoingAt` prefers from that date on, so the earlier one's reach is a
            // point. Anything else and the two directions would disagree.
            const list = byType.get(instruction.type) ?? EMPTY;
            const at = list.indexOf(instruction);
            const next = at >= 0 ? list[at + 1] : undefined;
            const to = Math.min(boundOf(instruction), next?.date ?? Infinity);
            // espressivo closes a span nothing follows at `Number.MAX_VALUE`; this reader says
            // `Infinity` for that, and nothing else it returns is anywhere near either.
            return { from: instruction.date, to: to >= Number.MAX_VALUE ? Infinity : to };
        },

        ofType: type => byType.get(type) ?? EMPTY,

        tempoAround: instruction => around(instruction, tempoOf),

        dynamicsAround: instruction => around(instruction, dynamicsOf),

        tempoOf,
        dynamicsOf,
        movementOf,

        defFor: ({ type, date, map, element }) => {
            const ref = STYLE_REF[type];
            if (!ref) return null;
            const name = element.getAttributeValue(ref.attribute);
            // A `@bpm` of `59.15` names no def; a `@bpm` of `Allegro` does.
            if (name === null || name.trim() === '' || Number.isFinite(Number(name))) return null;
            return map.getStyleAt(date, ref.kind)?.getDef(name)?.getXmlOrNull() ?? null;
        },
    };
};

const EMPTY: readonly Instruction[] = [];

const tempoOf = ({ map, index }: Instruction) =>
    map instanceof TempoMap ? map.getTempoDataOf(index) : null;

const dynamicsOf = ({ map, index }: Instruction) =>
    map instanceof DynamicsMap ? map.getDynamicsDataOf(index) : null;

const movementOf = ({ map, index }: Instruction) =>
    map instanceof MovementMap ? map.getMovementDataOf(index) : null;

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

export { dynamicsAt, positionAt, tempoAt };
export type { Dynamics, Element, Movement, Tempo };
