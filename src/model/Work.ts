/**
 * The work file: what a reconstruction is saved as, and read back from.
 *
 * One array, and the little that names it: **`provenance`**, the calls, in the order they ran,
 * each with the options it ran with. Rebuild the chain out of it, run it over the same MEI, and
 * the same MPM comes back.
 */

/** What a reconstruction is *of*: a name, and the two documents it moves between. */
interface Work {
    name: string;
    /** Path to the MEI, relative to the file. Always `transcription.mei` so far. */
    mei: string;
    /** Path to the MPM the chain writes. Always `performance.mpm` so far. */
    mpm: string;
}

/**
 * One transformer call, as the file records it: enough to build it and run it again.
 *
 * `options` is plain JSON and stays plain. A `Set`-valued option crosses as
 * `{ dataType: 'Set', value: [...] }` and a `Map` as `{ dataType: 'Map', value: [[k, v], ...] }`
 * — the envelope espressivo's `importWork` decodes. Anything that rewrites a work file has to
 * carry those through byte for byte rather than parsing and re-encoding them: the shipped
 * reconstruction holds 87 of them, and a reviver that ran on the way in without a matching
 * replacer on the way out would turn every one into `{}`.
 */
export interface Call {
    id: string;
    /** The name of the transformer that made the call, as the registry knows it. */
    name: string;
    options: Record<string, unknown>;

    /**
     * The `xml:id`s this call is answerable for, as of the run it was last saved from.
     *
     * **Recorded, because it cannot be derived.** A call's elements are the difference the
     * document shows before and after it runs — which credits a call that *reshaped* an
     * instruction as well as one that added it — so nothing short of running the chain can say
     * what they are. Written down, the published file says without a chain which decision wrote
     * which instruction of `performance.mpm`.
     */
    elements?: string[];

    /**
     * The stretch of score it acted on, in ticks. `to` is null where it names a date rather than
     * a span; the whole field is absent where it names no place at all.
     *
     * Recorded for one reason: **`InsertPedal` has no other way to be placed.** Every other
     * call's range is a pure function of its own options, but a recorded pedal has no symbolic
     * date, so putting one on the tick grid takes the residual — and the residual takes a run.
     * Storing it for every call rather than only for pedals keeps the reader from needing to
     * know which is which.
     */
    range?: { from: number; to: number | null };
}

export interface WorkFile extends Work {
    provenance: Call[];
    /**
     * Desk state that is not part of what the pipeline reads — today the tempo desk's clusters,
     * its silent onsets and its drawn lines. Opaque here on purpose: the file carries it so a
     * desk can reopen where it was left, and nothing else may depend on its shape.
     */
    secondary?: Record<string, unknown>;
}

// The envelopes are why these are not `JSON.parse`/`JSON.stringify` at the call site. A
// transformer's options are not only JSON data: `InsertArticulation` takes a `Set` of aspects
// and `InsertDynamicsInstructions` a `Map` of phantom velocities, and both must survive the
// round trip.
//
// Getting it wrong is silent in one direction and loud in the other. A reviver without a
// matching replacer turns all 87 envelopes in the shipped file into `{}`, which has no `.get`,
// so the first phantom velocity read throws somewhere else entirely. A replacer without a
// reviver writes envelopes nothing ever opens.

/** `Map` and `Set` survive the round trip; nothing else needs to. */
function replacer(_: string, value: unknown) {
    if (value instanceof Map) return { dataType: 'Map', value: Array.from(value.entries()) };
    if (value instanceof Set) return { dataType: 'Set', value: Array.from(value.values()) };
    return value;
}

function reviver(_: string, value: unknown) {
    if (typeof value === 'object' && value !== null && 'dataType' in value) {
        const envelope = value as { dataType?: unknown; value?: unknown };
        if (envelope.dataType === 'Map' && Array.isArray(envelope.value))
            return new Map(envelope.value as [unknown, unknown][]);
        if (envelope.dataType === 'Set' && Array.isArray(envelope.value))
            return new Set(envelope.value as unknown[]);
    }
    return value;
}

/**
 * What a work file saved before November 2026 carries and this one does not: the claims the
 * calls were grouped under, `segments` beside the provenance and a `segment` on each call.
 */
interface LegacyWorkFile extends WorkFile {
    segments?: unknown;
    provenance: (Call & { segment?: unknown })[];
}

/**
 * Read a work file, reviving the `Map` and `Set` options a chain needs in order to run.
 *
 * Deliberately *not* validating beyond the shape: a file naming a transformer this build does
 * not have is a real case — it is what a reconstruction saved by a newer build looks like — and
 * it is the chain builder's business to report, not this function's to refuse.
 *
 * The claims an older file grouped its calls under are dropped on the way in, so that the next
 * save writes a file without them. Nothing reads them any more, and a field carried through
 * unread is one nobody can edit.
 */
export function parseWorkFile(json: string): WorkFile {
    const work = JSON.parse(json, reviver) as LegacyWorkFile;
    delete work.segments;
    for (const call of work.provenance) delete call.segment;
    return work;
}

/** Write a work file, with the `Map` and `Set` options wrapped so they survive. */
export function serializeWorkFile(work: WorkFile): string {
    return JSON.stringify(work, replacer, 2);
}

/**
 * The recording ids a `MakeChoice` call preferred — which reading each note was taken from.
 *
 * Read off the provenance rather than stored.
 */
export const sourcesOf = (provenance: readonly Call[]): string[] => {
    const options = provenance
        .filter((call) => call.name === 'MakeChoice')
        .map((call) => call.options);
    const ids = options.flatMap((o) =>
        typeof o['prefer'] === 'string'
            ? [o['prefer']]
            : [o['velocity'], o['timing'], o['pedalling']],
    );
    return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string')));
};
