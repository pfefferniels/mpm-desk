import { parseWorkFile, type WorkFile } from './Work';
import { migrateWork, isMigrated } from './migrateWork';
import { isInjectedCall } from '../fitting/chain';

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

    // Lifted as well as migrated. The first two lifts cannot fire on what `migrateWork` writes —
    // it writes today's shape — but `dropInjectedCalls` can, because a JSON-LD graph records the
    // tempo-desk button being pressed like any other call. Every path arrives at one shape.
    const { work } = migrateWork(parsed);
    return parseWorkFile(JSON.stringify(lift(work) ?? work));
}

/**
 * Bring a flat work file up to the shape this build reads.
 *
 * Three lifts, all pure rewrites of what the file already says: no rule, no decision, nothing
 * lost. Returns `null` when none applies, so the caller can keep the original text and its option
 * envelopes rather than re-serializing a file that was already right.
 */
function lift(work: WorkFile): WorkFile | null {
    const linked = liftSegmentLinks(work);
    const folded = foldCommentary(linked ?? work);
    const dropped = dropInjectedCalls(folded ?? linked ?? work);
    return dropped ?? folded ?? linked;
}

/**
 * Drop the call the run now makes for itself.
 *
 * `buildChain` injects `TranslatePhysicalTimeToTicks` and filters a saved one out, so a file
 * naming one names a call that can neither run nor be edited: clicking it in the narrative desk
 * routes to a tempo desk with no control for it, and it sits in the document claiming
 * instructions it does not touch.
 *
 * A claim the call was the only thing made under goes with it. Not because an empty claim is
 * worthless (one somebody else emptied is theirs to dissolve, and is left alone) but because a
 * claim that only ever held plumbing was never a claim.
 *
 * The instructions are not orphaned: `Call.elements` credits reshaping as readily as writing,
 * and every ornament here was *written* by the `InsertTemporalSpread` call that still holds it.
 * What goes is the duplicate chip.
 */
export function dropInjectedCalls(work: WorkFile): WorkFile | null {
    const injected = work.provenance.filter((call) => isInjectedCall(call.name));
    if (!injected.length) return null;

    const provenance = work.provenance.filter((call) => !isInjectedCall(call.name));
    const stillNamed = new Set(provenance.map((call) => call.segment));
    const emptied = new Set(
        injected
            .map((call) => call.segment)
            .filter((id) => id !== undefined && !stillNamed.has(id)),
    );

    return {
        ...work,
        provenance,
        segments: work.segments.filter((segment) => !emptied.has(segment.id)),
    };
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
 * This one is *lossless*: a call already is the thing that wrote a gesture, so moving its id onto
 * the call restates a fact the file has rather than deriving a new one. A list of element ids
 * would have to decide the 163 instructions more than one call is answerable for, since
 * `Call.elements` is a before-and-after diff and `StylizeOrnamentation` points all 100 ornaments
 * at shared defs. Any rule for splitting those bakes an answer into the file, where here the
 * ambiguity stays in the view.
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
 * An older shape carried `note`, the gesture word, beside `commentary`, longer editorial prose.
 * Three of 137 segments carry both, and two read as one sentence continued: „Großangelegtes
 * Decrescendo" and "der dynamische Verlauf folgt dem Tonhöhenverlauf" are a narrative and the
 * rest of it rather than a label and an apparatus entry. Two fields mean deciding per sentence
 * which kind of writing a note is.
 *
 * Joined with an em-dash, and only where both are present: a segment carrying commentary alone
 * keeps it as its whole note.
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
