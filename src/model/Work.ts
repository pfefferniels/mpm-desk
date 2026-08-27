/**
 * The work file: what a reconstruction is saved as, and read back from.
 *
 * Two arrays, and nothing else.
 *
 * - **`provenance`** — the calls, in the order they ran, each with the options it ran with.
 *   This is the reconstructible half: rebuild the chain out of it, run it over the same MEI, and
 *   the same MPM comes back.
 * - **`segments`** — what the reconstruction claims, one entry per claim. A segment holds prose
 *   and nothing else; which instructions it covers is read off {@link Call.segment}, which is
 *   where the link lives.
 *
 * A claim says what it claims in its own words, in {@link Segment.note}. There is no controlled
 * vocabulary behind it: a fixed set of motivations is a worse version of the prose a
 * reconstruction already writes, and a placeholder that reads like a real word cannot be told
 * from one on the page.
 *
 * A JSON-LD file in CIDOC-CRM and CRMinf is read by migrating it — see `migrateWork.ts`, which
 * also records what that shape carried and what became of it.
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
    /**
     * The transformer's name as it was written, not as it is spelled now. The registry keeps
     * aliases, which is why `TranslatePhyiscalTimeToTicks` still loads.
     */
    name: string;
    options: Record<string, unknown>;

    /**
     * The `xml:id`s this call is answerable for, as of the run it was last saved from.
     *
     * **Recorded, because it cannot be derived.** A call's elements are the difference the
     * document shows before and after it runs — which credits a call that *reshaped* an
     * instruction as well as one that added it — so nothing short of running the chain can say
     * what they are.
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

    /**
     * The {@link Segment} this call's instructions are claimed under. Absent while it is claimed
     * under none, which is what a call made a moment ago looks like.
     *
     * **This is the link, and it points this way round on purpose.** What an editor groups is
     * MPM instructions — a `<tempo>`, the two ends of a dynamics ramp — and this is the only
     * place that says which claim an instruction serves, because nothing else can:
     *
     * - The instruction cannot. A `<tempo>`'s attributes say what it does to the sound and
     *   nothing about why. Writing the segment into it as `@corresp` is what the JSON-LD file
     *   did, and it puts editorial grouping inside the performance document.
     * - Its date cannot. The claims overlap heavily — 195 overlapping pairs in the shipped
     *   reconstruction, 78 of them nested, „Intensivieren" sitting inside „Hinspielen zur 1" —
     *   so a tick names no single segment.
     *
     * So it is recorded, and recorded here rather than as a list of element ids on the segment.
     * A call is the unit that writes a gesture — `InsertPedal` writes a press as `_start` plus
     * `_moveDown`, `InsertDynamicsInstructions` writes the two ends of one ramp — so a list on
     * the segment would be able to express splitting those, which is not a thing anyone wants,
     * at the price of a second copy of what {@link Call.elements} already says.
     *
     * A call that writes no instruction — `Modify`, `MakeChoice`, `InsertMetadata` — may carry
     * one and contributes nothing to the narrative regardless, because the narrative is built
     * from elements and it has none. It is excluded by having nothing to show rather than by
     * anyone keeping a list of which transformers count.
     */
    segment?: string;
}

/**
 * A claim the reconstruction makes about a stretch of the performance.
 *
 * Editorial content and nothing else. It names no members: which instructions a claim covers is
 * read the other way, off {@link Call.segment} and through {@link Call.elements}, so that the
 * same fact is written once. What the calls *did* — what they wrote, where they acted — stays on
 * the calls, and a list here would be the same facts at a coarser grain, free to disagree with
 * the finer ones.
 */
export interface Segment {
    id: string;
    /**
     * The narrative: what is going on in the performer's head here, in the reconstruction's own
     * words. „Nachschlag schattieren", „Hineinfallen", „mit Inegalité vorwärts zum b".
     *
     * **The only thing a segment says about itself.** It is the label the tree of words shows,
     * and the reason a reader can see the shape of a reconstruction without reading a single
     * option. It came from the old `argumentation.conclusion.note`; the old
     * `argumentation.note`, a second field for longer editorial prose, was folded into it — three
     * entries, and two of them read as the same sentence continued („Großangelegtes Decrescendo
     * — der dynamische Verlauf folgt dem Tonhöhenverlauf"). Two fields for one narrative meant
     * deciding, per sentence, which kind of writing it was; there is one, and the drawing writes
     * all of it.
     *
     * The tree sets it along a branch at whatever length it runs to, so a long one is a long
     * branch — see `segment-stack/words.ts`.
     */
    note?: string;
    /**
     * The id of the segment this one picks up from, where the gesture runs on across a break.
     *
     * **Recorded, not used.** Nothing reads it: the viewer dropped chaining when the words
     * arrived — one word per segment leaves nothing to merge — and the projection stopped
     * carrying it when that became clear. It stays in the file because it is thirteen recorded
     * editorial judgements, migrated out of the JSON-LD `continue` and checked to resolve; a
     * format that drops what it has no current use for is a format that loses scholarship.
     *
     * A link between segments, not a flag on a call — and specifically **not** espressivo's
     * `ApproximateLogarithmicTempo.continue`, which is a boolean option on one transformer that
     * this reconstruction never uses. Two of the thirteen name the same predecessor, so it is a
     * forest rather than a chain: read it as "picks up from", not "next".
     */
    continues?: string;
}

export interface WorkFile extends Work {
    provenance: Call[];
    segments: Segment[];
    /**
     * Desk state that is not part of what the pipeline reads — today the tempo desk's clusters,
     * its silent onsets and its drawn lines. Opaque here on purpose: the file carries it so a
     * desk can reopen where it was left, and nothing else may depend on its shape.
     */
    secondary?: Record<string, unknown>;
}

// ── reading and writing the file ──────────────────────────────────
//
// The envelope handling is the whole reason these are not `JSON.parse`/`JSON.stringify` at the
// call site. A transformer's options are data, but not *only* JSON data: `InsertArticulation`
// takes a `Set` of aspects and `InsertDynamicsInstructions` a `Map` of phantom velocities, and
// both have to survive the round trip. They cross as the envelopes below.
//
// Getting this wrong is silent in one direction and loud in the other. A reviver without a
// matching replacer turns all 87 envelopes in the shipped file into `{}` — and `{}` has no
// `.get`, so the first phantom velocity read throws somewhere else entirely. A replacer without
// a reviver writes envelopes nothing ever opens.

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
 * Read a work file, reviving the `Map` and `Set` options a chain needs in order to run.
 *
 * Deliberately *not* validating beyond the shape: a file naming a transformer this build does
 * not have is a real case — it is what a reconstruction saved by a newer build looks like — and
 * it is the chain builder's business to report, not this function's to refuse.
 */
export function parseWorkFile(json: string): WorkFile {
    return JSON.parse(json, reviver) as WorkFile;
}

/** Write a work file, with the `Map` and `Set` options wrapped so they survive. */
export function serializeWorkFile(work: WorkFile): string {
    return JSON.stringify(work, replacer, 2);
}

/**
 * The recording ids a `MakeChoice` call preferred — which reading each note was taken from.
 *
 * Read off the provenance rather than stored. A JSON-LD file states it separately, and the
 * migration refuses to run unless the stated value and this one agree.
 */
export const sourcesOf = (provenance: readonly Call[]): string[] => {
    const options = provenance
        .filter((call) => call.name === 'MakeChoice')
        .map((call) => call.options as Record<string, unknown>);
    const ids = options.flatMap((o) =>
        typeof o['prefer'] === 'string'
            ? [o['prefer']]
            : [o['velocity'], o['timing'], o['pedalling']],
    );
    return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string')));
};
