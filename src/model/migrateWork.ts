/**
 * The one-way door out of the JSON-LD work file.
 *
 * `public/info.json` was written as a CIDOC-CRM / CRMinf graph: a `Reconstruction` whose
 * `creation` held 136 `I1_Argumentation`s, each with a `calls` list and an `I2_Belief` under
 * `conclusion`. What is going in its place is {@link WorkFile} — a flat `provenance` of every
 * call, each naming the segment it is claimed under, and one prose `segment` per argumentation.
 *
 * Run it:
 *
 * ```sh
 * node scripts/migrateWork.ts public/info.json public/work.json
 * # or, if this Node does not strip types:
 * npx vite-node scripts/migrateWork.ts -- public/info.json public/work.json
 * ```
 *
 * **Idempotent.** Handed a file that is already a `WorkFile`, it hands it straight back. That is
 * not politeness — it is what lets the script be re-run against a directory without anyone
 * having to remember which files have been through it.
 *
 * ## What it carries that espressivo's `WorkFile` has no field for
 *
 * `certainty` is DROPPED outright, and `motivation` is **spent, then dropped**.
 *
 * Both were already retired upstream: espressivo's `work.ts` dropped them because nothing read
 * them, and the viewer removed `certainty` from data and code in one commit. But `motivation` was
 * still doing one job at the moment of retirement — it was the fallback the tree wrote when a
 * segment had no prose of its own, through a placeholder table in `words.ts`. Deleting the field
 * and the table together would have left forty of the 136 segments with no word at all.
 *
 * So the migration cashes it in. Where a group has no `note`, its motivation is turned into the
 * word the table would have written and stored AS the note; then the field goes. After this runs,
 * every segment says something, no segment carries a motivation, and the tree needs no fallback —
 * which is what lets `words.ts` be a single field read rather than a vocabulary.
 *
 * It is a one-way door in the strong sense: the enum's information is not lost but it is no longer
 * separable, and „Intensivieren" written by this migration is indistinguishable afterwards from
 * „Intensivieren" somebody typed. That is the intended outcome — the distinction was between a
 * placeholder and a word, and placeholders are what this removes. The old text —
 * is, and how sure the reconstruction is of it. espressivo dropped both when it took the work
 * file, because a library that renders a document has no opinion about either. Losing them here
 * would lose the only part of the old ontology that anyone ever read.
 *
 * `continue` becomes {@link Segment.continues}, a link from one segment to the one it picks up
 * from. All 13 of them resolve; two name the same predecessor.
 *
 * `argumentation.note` — the second prose field — is **folded into the segment's note**, joined
 * with an em-dash. Three argumentations carry one, all three on a segment that already has a
 * word, and two of them read as that word's sentence continued. One narrative per segment is
 * what the tree draws and what the desk edits; two fields meant deciding per sentence which kind
 * of writing it was.
 *
 * ## What it drops, and why each is safe
 *
 * - **`@context`, `@type`, `argumentation.type`** — JSON-LD plumbing. `type` is
 *   `"simpleArgumentation"` on 132 of 136 and absent on the rest, so it discriminates nothing.
 * - **`conclusion.id`** — the belief node's identity, 132 unique ids. Nothing in the document
 *   references one: the `continue` links all point at *argumentation* ids, never at a belief.
 *   It existed so the graph could be addressed as a graph, and there is no graph now.
 * - **`creation.incorporates`** — the recording the reconstruction was made from. It is exactly
 *   the `prefer` of the file's one `MakeChoice` call, which is how espressivo's `sourcesOf`
 *   already derives it. {@link checkIncorporatesIsDerivable} proves that for the file in hand
 *   and refuses the migration if it does not hold, so this is a measured claim rather than an
 *   assumption carried forward.
 *
 * ## What it must not touch
 *
 * A call's `options` crosses verbatim. The file holds 87 `{ dataType: 'Set' | 'Map' }` envelopes,
 * and they are only plain JSON on the way through here — reading with a reviver and writing
 * without a matching replacer would turn each of them into `{}`, silently, in a file nobody
 * reads by eye. `secondary` crosses the same way, by reference.
 */
import type { Call, Segment, WorkFile } from './Work';

/** Transformers this build no longer registers. None appears in the shipped file; one might. */
/**
 * What each motivation was written as, when a segment had no words of its own.
 *
 * Lifted verbatim from the viewer's `words.ts`, which is where it lived and where it has now been
 * deleted. This is its last use: the migration spends the enum and the table goes with it.
 *
 * `unknown` is a real value in the old data — eight groups carry it, and all eight are among the
 * forty with no prose — so it needs a word like the rest. „Unbestimmt" is what the table said,
 * and it is honest: those eight say that nothing in particular was claimed, which is different
 * from a group that was never named at all.
 */
const MOTIVATION_WORDS: Record<string, string> = {
    intensify: 'Intensivieren',
    move: 'Bewegen',
    relax: 'Zurücknehmen',
    calm: 'Beruhigen',
    unknown: 'Unbestimmt',
};

const RETIRED_TRANSFORMERS = new Set([
    'InsertAsynchrony',
    'CompressOrnamentation',
    'ApproximateLogarithmicTempo',
    'StylizeArticulation',
    'MakeDefaultArticulation',
    'CombineAdjacentRubatos',
]);

// ── the old shape ─────────────────────────────────────────────────

interface OldCall {
    id: string;
    name: string;
    options: Record<string, unknown>;
    created?: string[];
}

interface OldConclusion {
    id?: string;
    certainty?: string;
    motivation?: string;
    note?: string;
}

interface OldArgumentation {
    id: string;
    type?: string;
    note?: string;
    conclusion: OldConclusion;
    calls: OldCall[];
    continue?: string;
}

interface OldWorkFile {
    name: string;
    mei: string;
    mpm: string;
    creation: { incorporates?: string[]; argumentations: OldArgumentation[] };
    secondary?: Record<string, unknown>;
}

// ── the report ────────────────────────────────────────────────────

/**
 * What one migration actually did, in numbers.
 *
 * Returned rather than logged, so the test can assert on it and the CLI can print it. Every
 * field is something that was counted during the walk, not something the script expected.
 */
export interface MigrationReport {
    /** True when the input was already a {@link WorkFile} and nothing was done to it. */
    alreadyMigrated: boolean;
    argumentations: number;
    calls: number;
    segments: number;
    /** Distinct transformer names in `provenance`. */
    transformerNames: string[];
    callsWithElements: number;
    /** Element ids across every segment, deduplicated within each segment. */
    elements: number;
    /** How many `created` entries were dropped as duplicates inside one segment. */
    duplicateElements: number;
    segmentsWithNote: number;
    /** Argumentations that carried the second prose field, now folded into the note. */
    foldedCommentaries: number;
    segmentsWithContinues: number;
    /** The `incorporates` value, and the sources derived from `MakeChoice` that matched it. */
    incorporates: string[];
    /** Calls naming a transformer this build does not have. Carried, but named here. */
    retiredCalls: { id: string; name: string }[];
}

// ── narrowing ─────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** A trimmed string, or `undefined` where the old file wrote `''` to mean "nothing here". */
const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
};

const readCall = (value: unknown, where: string): OldCall => {
    if (!isRecord(value)) throw new Error(`${where} is not an object`);
    if (typeof value['id'] !== 'string') throw new Error(`${where} has no id`);
    if (typeof value['name'] !== 'string') throw new Error(`${where} has no name`);
    return {
        id: value['id'],
        name: value['name'],
        options: isRecord(value['options']) ? value['options'] : {},
        created: Array.isArray(value['created'])
            ? value['created'].filter((id): id is string => typeof id === 'string')
            : [],
    };
};

const readArgumentation = (value: unknown, index: number): OldArgumentation => {
    const where = `creation.argumentations[${String(index)}]`;
    if (!isRecord(value)) throw new Error(`${where} is not an object`);
    if (typeof value['id'] !== 'string') throw new Error(`${where} has no id`);
    if (!Array.isArray(value['calls'])) throw new Error(`${where} has no calls list`);

    const conclusion = isRecord(value['conclusion']) ? value['conclusion'] : {};
    return {
        id: value['id'],
        ...(typeof value['type'] === 'string' && { type: value['type'] }),
        ...(typeof value['note'] === 'string' && { note: value['note'] }),
        conclusion: {
            ...(typeof conclusion['id'] === 'string' && { id: conclusion['id'] }),
            ...(typeof conclusion['certainty'] === 'string' && { certainty: conclusion['certainty'] }),
            ...(typeof conclusion['motivation'] === 'string' && { motivation: conclusion['motivation'] }),
            ...(typeof conclusion['note'] === 'string' && { note: conclusion['note'] }),
        },
        calls: value['calls'].map((call, position) =>
            readCall(call, `${where}.calls[${String(position)}]`),
        ),
        ...(typeof value['continue'] === 'string' && { continue: value['continue'] }),
    };
};

const readOldWork = (value: unknown): OldWorkFile => {
    if (!isRecord(value)) throw new Error('not a work file: expected a JSON object');
    if (!isRecord(value['creation'])) throw new Error('not an old work file: no `creation` node');
    if (!Array.isArray(value['creation']['argumentations']))
        throw new Error('not an old work file: `creation.argumentations` is missing or not a list');

    const incorporates = value['creation']['incorporates'];
    return {
        name: typeof value['name'] === 'string' ? value['name'] : '',
        mei: typeof value['mei'] === 'string' ? value['mei'] : '',
        mpm: typeof value['mpm'] === 'string' ? value['mpm'] : '',
        creation: {
            ...(Array.isArray(incorporates) && {
                incorporates: incorporates.filter((id): id is string => typeof id === 'string'),
            }),
            argumentations: value['creation']['argumentations'].map(readArgumentation),
        },
        ...(isRecord(value['secondary']) && { secondary: value['secondary'] }),
    };
};

/**
 * Whether this is already the new shape.
 *
 * `provenance` is the discriminator and `creation` is its absence: a file cannot be both, and a
 * half-migrated one is a bug worth an exception rather than a guess.
 */
/**
 * One narrative out of the two prose fields the graph filed apart.
 *
 * Em-dashed rather than newlined: the tree writes this along a branch, so it has to read as one
 * line. A segment carrying only the longer prose keeps it as its whole note rather than losing
 * it — which does not happen in the shipped file, and would be a silent loss if it did.
 */
const joined = (note: string | undefined, commentary: string | undefined): string | undefined => {
    if (note === undefined) return commentary;
    if (commentary === undefined) return note;
    return `${note} — ${commentary}`;
};

export const isMigrated = (value: unknown): value is WorkFile => {
    if (!isRecord(value)) return false;
    const migrated = Array.isArray(value['provenance']) && Array.isArray(value['segments']);
    if (migrated && isRecord(value['creation']))
        throw new Error('this file has both `provenance` and `creation`; it is neither shape');
    return migrated;
};

// ── the checks ────────────────────────────────────────────────────

/**
 * `creation.incorporates` names the recording the reconstruction was made from, and the chain's
 * `MakeChoice` call names the same thing in its options. Prove they agree before dropping one.
 *
 * The two spellings of a preference are espressivo's: `{ prefer }` picks one reading for
 * everything, `{ velocity, timing, pedalling }` splits it three ways. Both are read here for the
 * same reason `sourcesOf` reads both — a file using the split form is still a file whose sources
 * are recoverable.
 */
export const checkIncorporatesIsDerivable = (old: OldWorkFile): string[] => {
    const declared = old.creation.incorporates ?? [];
    if (declared.length === 0) return [];

    const derived = new Set<string>();
    for (const argumentation of old.creation.argumentations) {
        for (const call of argumentation.calls) {
            if (call.name !== 'MakeChoice') continue;
            const options = call.options;
            for (const key of ['prefer', 'velocity', 'timing', 'pedalling']) {
                const value = options[key];
                if (typeof value === 'string') derived.add(value);
            }
        }
    }

    const missing = declared.filter((id) => !derived.has(id));
    if (missing.length > 0)
        throw new Error(
            `creation.incorporates names ${missing.join(', ')}, which no MakeChoice call in the ` +
                'chain prefers. It is therefore not derivable from the provenance and must not ' +
                'be dropped — carry it across by hand and say so.',
        );
    return declared;
};

// ── the migration ─────────────────────────────────────────────────

/**
 * The old file as a {@link WorkFile}, plus what the walk counted.
 *
 * Handed something already migrated, it returns that value untouched — not a copy, and not a
 * re-serialization, so running the script twice cannot change a byte.
 */
export const migrateWork = (input: unknown): { work: WorkFile; report: MigrationReport } => {
    if (isMigrated(input)) {
        return {
            work: input,
            report: {
                alreadyMigrated: true,
                argumentations: 0,
                calls: input.provenance.length,
                segments: input.segments.length,
                transformerNames: [...new Set(input.provenance.map((call) => call.name))].sort(),
                callsWithElements: 0,
                elements: new Set(input.provenance.flatMap((call) => call.elements ?? [])).size,
                duplicateElements: 0,
                segmentsWithNote: input.segments.filter((segment) => segment.note).length,
                foldedCommentaries: 0,
                segmentsWithContinues: input.segments.filter((segment) => segment.continues).length,
                incorporates: [],
                retiredCalls: input.provenance
                    .filter((call) => RETIRED_TRANSFORMERS.has(call.name))
                    .map(({ id, name }) => ({ id, name })),
            },
        };
    }

    const old = readOldWork(input);
    const argumentations = old.creation.argumentations;
    const incorporates = checkIncorporatesIsDerivable(old);

    const ids = new Set(argumentations.map((argumentation) => argumentation.id));
    if (ids.size !== argumentations.length)
        throw new Error('two argumentations share an id; segments would collide');

    const provenance: Call[] = [];
    const segments: Segment[] = [];
    const seenCalls = new Set<string>();
    const seenElements = new Set<string>();
    let duplicateElements = 0;
    let callsWithElements = 0;
    let commentaries = 0;

    for (const argumentation of argumentations) {
        const where = `argumentation ${argumentation.id}`;
        // The motivation, spent: where the group named itself, its own words win; where it did
        // not, the enum becomes the word and is not carried forward. A motivation the table has
        // never met would silently produce a wordless segment, so it is refused instead.
        const stated = text(argumentation.conclusion.note);
        const motivation = text(argumentation.conclusion.motivation);
        if (stated === undefined && motivation !== undefined && !(motivation in MOTIVATION_WORDS))
            throw new Error(
                `${where}: "${motivation}" is not a motivation this migration has a word for, ` +
                    'and the group has no note of its own to fall back on. Add it to ' +
                    '`MOTIVATION_WORDS` deliberately rather than letting a segment lose its word.',
            );
        const word = stated ?? (motivation !== undefined ? MOTIVATION_WORDS[motivation] : undefined);
        const commentary = text(argumentation.note);
        if (commentary !== undefined) commentaries += 1;
        const note = joined(word, commentary);

        // A dangling link would leave a segment claiming to continue something that is not
        // there, which reads on the tree as a gesture that starts mid-air.
        if (argumentation.continue !== undefined && !ids.has(argumentation.continue))
            throw new Error(
                `${where} continues ${argumentation.continue}, which is not an argumentation in ` +
                    'this file',
            );
        for (const call of argumentation.calls) {
            if (seenCalls.has(call.id))
                throw new Error(`call ${call.id} appears in more than one argumentation`);
            seenCalls.add(call.id);

            // `created` is per call in the old file too, so the outcome moves straight across.
            // The range is not there and cannot be invented — `scripts/recordOutcomes.ts` runs
            // the chain once and fills it in.
            const created = call.created ?? [];
            provenance.push({
                id: call.id,
                name: call.name,
                options: call.options,
                ...(created.length > 0 && { elements: [...created] }),
                // The link, written on the call rather than listed on the segment — see
                // `Call.segment`. An argumentation names its calls exactly once (checked just
                // above), so the transposition is total and loses nothing.
                segment: argumentation.id,
            });
            if (created.length > 0) callsWithElements += 1;

            // Two calls of one segment naming the same element is real — the shipped file has
            // three, all a `<tempo>` reshaped by a second `InsertTempo` — and both calls are
            // answerable for it. Counted so the total below is honest about the overlap rather
            // than reporting more distinct elements than the document holds.
            for (const element of created) {
                if (seenElements.has(element)) duplicateElements += 1;
                else seenElements.add(element);
            }
        }

        segments.push({
            id: argumentation.id,
            // Two prose fields become one. The gesture word lives on the conclusion and the
            // longer prose on the argumentation, which is the opposite of what the field names
            // suggest — `conclusion.note` is 96 entries averaging 29 characters and carries
            // every „schattieren", „Hineinfallen" and „Nachlauschen" in the file, and
            // `argumentation.note` is 3. All three of those sit on a segment that also has a
            // word, and two of them read as that word's sentence continued, so they are joined
            // rather than filed apart: see `foldCommentary` in `loadWork.ts`.
            ...(note !== undefined && { note }),
            ...(argumentation.continue !== undefined && { continues: argumentation.continue }),
        });
    }

    const work: WorkFile = {
        name: old.name,
        mei: old.mei,
        mpm: old.mpm,
        provenance,
        segments,
        ...(old.secondary !== undefined && { secondary: old.secondary }),
    };

    return {
        work,
        report: {
            alreadyMigrated: false,
            argumentations: argumentations.length,
            calls: provenance.length,
            segments: segments.length,
            transformerNames: [...new Set(provenance.map((call) => call.name))].sort(),
            callsWithElements,
            elements: seenElements.size,
            duplicateElements,
            segmentsWithNote: segments.filter((segment) => segment.note).length,
            foldedCommentaries: commentaries,
            segmentsWithContinues: segments.filter((segment) => segment.continues).length,
            incorporates,
            retiredCalls: provenance
                .filter((call) => RETIRED_TRANSFORMERS.has(call.name))
                .map(({ id, name }) => ({ id, name })),
        },
    };
};

/** Text in, text out. Two-space indent, which is what the old file used. */
export const migrateWorkText = (json: string): { text: string; report: MigrationReport } => {
    const { work, report } = migrateWork(JSON.parse(json) as unknown);
    return { text: `${JSON.stringify(work, null, 2)}\n`, report };
};

// ── the command ───────────────────────────────────────────────────

export const describe = (report: MigrationReport): string => {
    const lines = [
        report.alreadyMigrated
            ? 'already migrated — written back unchanged'
            : `${String(report.argumentations)} argumentations -> ${String(report.segments)} segments`,
        `${String(report.calls)} calls in provenance, ${String(report.transformerNames.length)} distinct names`,
        `${String(report.callsWithElements)} calls carry elements; ${String(report.elements)} element ids, ${String(report.duplicateElements)} duplicate(s) folded`,
        `notes ${String(report.segmentsWithNote)}, folded commentaries ${String(report.foldedCommentaries)}, continues ${String(report.segmentsWithContinues)}`,
    ];
    if (report.incorporates.length > 0)
        lines.push(
            `incorporates ${report.incorporates.join(', ')} — derivable from MakeChoice, dropped`,
        );
    if (report.retiredCalls.length > 0)
        lines.push(
            `${String(report.retiredCalls.length)} call(s) name a retired transformer: ` +
                [...new Set(report.retiredCalls.map((call) => call.name))].join(', '),
        );
    return lines.join('\n');
};
