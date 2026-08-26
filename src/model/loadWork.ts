import { parseWorkFile, type WorkFile } from './Work';
import { migrateWork, isMigrated } from './migrateWork';

/**
 * Open a work file, whichever of the three shapes it is in.
 *
 * Every archive made before 2026-08-26 carries the JSON-LD/CIDOC-CRM graph — `@context`, a
 * `creation` holding `argumentations`, each with a `conclusion` — and there is a corpus of them.
 * The editor reads those by migrating on open rather than refusing them, so the conversion is
 * something that happens to a file you already have rather than a step you have to know about.
 *
 * The migration is `./migrateWork.ts`, the same code `scripts/migrateWork.ts` runs to produce
 * `public/work.json`, and it is deliberately not duplicated: it refuses rather than guesses on
 * anything it does not recognise — an unknown motivation, a dangling `continue`, an
 * `incorporates` that does not match the provenance — and those refusals belong in the app too.
 * A file that will not migrate cleanly is a file whose scholarship would be silently altered.
 *
 * The third shape is the short-lived one in between: a `WorkFile` whose segments still carry a
 * `calls` list. {@link liftSegmentLinks} turns those round.
 */
export function migrateIfNeeded(json: string): WorkFile {
    const parsed: unknown = JSON.parse(json);

    if (isMigrated(parsed)) {
        const lifted = lift(parsed as WorkFile);
        // Round-tripped through the reader either way, so that every path arrives by the same
        // one — the `Map` and `Set` option envelopes are revived in exactly one place.
        return lifted ? parseWorkFile(JSON.stringify(lifted)) : parseWorkFile(json);
    }

    const { work } = migrateWork(parsed);
    return parseWorkFile(JSON.stringify(work));
}

/**
 * Bring a flat work file up to the shape this build reads.
 *
 * Two changes have happened to that shape since it replaced the JSON-LD graph, and both are pure
 * rewrites of what the file already says — no rule, no decision, nothing lost. Returns `null`
 * when neither applies, so the caller can keep the original text and its option envelopes rather
 * than re-serializing a file that was already right.
 */
function lift(work: WorkFile): WorkFile | null {
    const linked = liftSegmentLinks(work);
    const folded = foldCommentary(linked ?? work);
    return folded ?? linked;
}

/** A segment as an earlier flat shape wrote it: the calls it held, and its second prose field. */
interface OlderSegment {
    id: string;
    note?: unknown;
    commentary?: unknown;
    calls?: unknown;
}

/**
 * Turn the segment→call link round, for a file written while it still pointed that way.
 *
 * A pure transposition: what a segment listed, each call now names. Nothing is decided and
 * nothing is lost — an id that appears under two segments keeps the first, which cannot happen
 * in a file the JSON-LD migration wrote because it refuses one that repeats a call.
 *
 * Returns `null` when there is nothing to lift, so the caller can keep the original text and its
 * option envelopes rather than re-serializing a file that was already right.
 *
 * ## Why this direction, and not a list of element ids on the segment
 *
 * Both would work, and the list was tried first. This one wins because it is *lossless*: a call
 * is already the thing that wrote a gesture, so moving its id onto the call restates a fact the
 * file has rather than deriving a new one. A list of element ids would have had to decide the
 * 163 instructions that more than one call is answerable for — `Call.elements` is derived by
 * diffing the document before and after, so `StylizeOrnamentation`, which points all 100
 * ornaments at shared defs, claims all 100 — and any rule for splitting those bakes an answer
 * into the file. Here the same ambiguity stays in the view, where changing your mind costs
 * nothing.
 */
export function liftSegmentLinks(work: WorkFile): WorkFile | null {
    const segments = work.segments as unknown as OlderSegment[];
    if (!segments.some((segment) => Array.isArray(segment.calls))) return null;

    const segmentOf = new Map<string, string>();
    for (const segment of segments) {
        if (!Array.isArray(segment.calls)) continue;
        for (const callId of segment.calls) {
            if (typeof callId === 'string' && !segmentOf.has(callId))
                segmentOf.set(callId, segment.id);
        }
    }

    return {
        ...work,
        provenance: work.provenance.map((call) => {
            const segment = segmentOf.get(call.id);
            return segment === undefined ? call : { ...call, segment };
        }),
        segments: segments.map((segment) => {
            const next = { ...segment };
            delete next.calls;
            return next as WorkFile['segments'][number];
        }),
    };
}

/**
 * Fold a segment's second prose field into the one thing it says.
 *
 * The file used to carry `note` — the gesture word — and `commentary` — longer editorial prose —
 * side by side. Three of 136 segments ever carried both, and two of them read as one sentence
 * continued: „Großangelegtes Decrescendo" and "der dynamische Verlauf folgt dem Tonhöhenverlauf"
 * are not a label and an apparatus entry, they are a narrative and the rest of it. Keeping two
 * fields meant deciding per sentence which kind of writing it was, which is not a decision
 * anybody wants to make while annotating.
 *
 * Joined with an em-dash, and only where both are present — a segment carrying commentary alone
 * keeps it as its whole note rather than losing it.
 */
export function foldCommentary(work: WorkFile): WorkFile | null {
    const segments = work.segments as unknown as OlderSegment[];
    if (!segments.some((segment) => typeof segment.commentary === 'string')) return null;

    return {
        ...work,
        segments: segments.map((segment) => {
            const next = { ...segment };
            const commentary = typeof next.commentary === 'string' ? next.commentary.trim() : '';
            delete next.commentary;
            if (!commentary) return next as WorkFile['segments'][number];

            const note = typeof next.note === 'string' ? next.note.trim() : '';
            next.note = note ? `${note} — ${commentary}` : commentary;
            return next as WorkFile['segments'][number];
        }),
    };
}
