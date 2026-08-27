/**
 * What the tree draws: the work file, projected onto the ticks its calls act on.
 *
 * Nothing is baked. Every call in a work file records the segment it is claimed under, the
 * `xml:id`s it is answerable for and the stretch of score it acted on, so gathering those by
 * segment and by MPM element type is the whole derivation — see `projectReconstruction`. Editor
 * and viewer read one document and agree by construction rather than by a build step being
 * re-run.
 *
 * The direction matters. A {@link Segment} is what the *work file* claims, in prose; the calls
 * name it rather than the other way round, so what a claim covers is read through the calls that
 * point at it. A {@link Span} is what those calls *did* to the document, and it exists only
 * after a run. Nothing here is an input to the chain.
 */

/**
 * One performance gesture inside a segment: a run of MPM elements of a single type, over the
 * ticks the gesture covers.
 *
 * The range is not derivable from the elements. An instruction's `date` says where it takes
 * effect, never how far it reaches — a single `<dynamics>` can govern a whole phrase — so the
 * span carries it explicitly, taken from the range the call reported.
 */
export interface Span {
    /** Stable id for selection; also the first entry of {@link elements}. */
    id: string;
    /** MPM element type: `tempo`, `dynamics`, `rubato`, `articulation`, … */
    type: string;
    from: number;
    to: number;
    /** The `xml:id`s of the MPM elements this gesture consists of. */
    elements: string[];
}

/**
 * A stretch of the piece the reconstruction makes one claim about — and what it did to get there.
 *
 * `from`/`to` are the union of the ranges of the calls claimed under it, so a segment covers
 * exactly the score its own gestures touch. They are equal for a segment that acts on a single
 * point in time.
 */
export interface Segment {
    id: string;
    /**
     * What the segment says, in the reconstruction's own words.
     *
     * Free German prose in the corpus — „Abschattieren", „Hineinfallen", „Nachlauschen" — and
     * it is what the tree writes along the branch. It is the ONLY thing a segment says about
     * itself: the second prose field the work file used to carry was folded into it. A segment
     * with no note has no word, and `segment-stack/words.ts` says so rather than inventing one.
     */
    note?: string;
    from: number;
    /** Equal to {@link from} for a segment that acts on a single point in time. */
    to: number;
    spans: Span[];
}

export interface Reconstruction {
    title: string;
    author: string;
    segments: Segment[];
}

/** One call's contribution to the projection: what it wrote, where it acted, and under which claim. */
export interface CallOutcome {
    /** The `Call.id` this is reporting for. */
    id: string;
    /**
     * The `Segment.id` this call's instructions are claimed under, as the work file records it.
     *
     * Carried rather than looked up because it is the only thing that says which claim an
     * instruction serves — see {@link Call.segment} in `Work.ts` for why the link points this
     * way. Absent for a call nobody has claimed yet, and for the `InsertMetadata` the runner
     * substitutes, which is not in the file's provenance at all.
     */
    segment?: string;
    /** The `xml:id`s of the MPM elements the call is answerable for — written or changed. */
    elements: readonly string[];
    /**
     * The stretch of score the call acted on, in ticks; `null` where it names no place at all.
     *
     * `to` is `null` where the call names a single date rather than a span — a `<tempo>` is
     * placed at a date and reaches to the next one, which is a fact about the map and not about
     * the call.
     */
    range: { from: number; to: number | null } | null;
}

/** The one thing the projection needs from the finished MPM: what type each element is. */
type ElementTypes = ReadonlyMap<string, string>;

/**
 * The outcomes a work file already records, as the projection wants them.
 *
 * This is why the viewer needs no chain: `Call.elements` and `Call.range` are written on save and
 * stored, so a reader can project the tree from the document alone.
 */
export const outcomesOf = (
    provenance: readonly {
        id: string;
        elements?: string[];
        range?: { from: number; to: number | null };
        segment?: string;
    }[],
): CallOutcome[] =>
    provenance.map((call) => ({
        id: call.id,
        elements: call.elements ?? [],
        range: call.range ?? null,
        ...(call.segment !== undefined && { segment: call.segment }),
    }));

/**
 * What a work file's segment carries into the projection: its prose, and nothing else.
 *
 * It names no members. The calls name it — see {@link CallOutcome.segment} — so what a claim
 * covers is gathered from the run rather than restated here.
 */
export interface SegmentClaim {
    id: string;
    note?: string;
}

/**
 * Project a run of the chain onto the tree's segments and spans.
 *
 * Three things go in — what the work file claims, what each call did and which claim it did it
 * under, and the element types of the document it wrote — and what comes out is what the tree
 * draws. Nothing is read off the MPM beyond the types, because everything else has already been
 * reported.
 *
 * Two kinds of loss are expected here rather than exceptional, and both are counted rather than
 * swallowed:
 *
 * - **A call's elements can outlive the instructions.** `created` is what a call was answerable
 *   for at the moment it ran; a later call in the chain may have merged or removed the very
 *   instruction it wrote. Such an id is no longer in the document and is dropped.
 * - **A group can end up with no span at all**, when every element every one of its calls wrote
 *   was removed again. It contributes nothing to draw and is left out — a segment with no
 *   gestures is not a claim about the performance, it is a claim that was overwritten.
 */
export function projectReconstruction(params: {
    title: string;
    author: string;
    claims: readonly SegmentClaim[];
    outcomes: readonly CallOutcome[];
    elementTypes: ElementTypes;
}): { reconstruction: Reconstruction; stats: ProjectionStats } {
    const { title, author, claims, outcomes, elementTypes } = params;

    const segments: Segment[] = [];
    const stats: ProjectionStats = {
        ungroupedCalls: 0,
        droppedElements: 0,
        droppedSpans: 0,
        emptySegments: 0,
        placelessSegments: 0,
    };

    // Gathered in chain order, which is the order `outcomes` arrives in. A segment's spans come
    // out in the order its calls ran, so a reader stepping through a claim sees it built the way
    // it was built.
    const claimed = new Set(claims.map((claim) => claim.id));
    const bySegment = new Map<string, CallOutcome[]>();
    for (const outcome of outcomes) {
        if (outcome.segment === undefined || !claimed.has(outcome.segment)) {
            stats.ungroupedCalls++;
            continue;
        }
        const existing = bySegment.get(outcome.segment);
        if (existing) existing.push(outcome);
        else bySegment.set(outcome.segment, [outcome]);
    }

    for (const claim of claims) {
        const called = bySegment.get(claim.id) ?? [];

        // The segment's own stretch, settled BEFORE any span is built. A call that acts on the
        // whole piece reports no range of its own and takes the segment's, so the segment's has
        // to exist first — reading it while it was still accumulating put such a span at
        // `Infinity`, which then poisoned every fallback downstream.
        let from = Infinity;
        let to = -Infinity;
        for (const outcome of called) {
            if (!outcome.range) continue;
            from = Math.min(from, outcome.range.from);
            to = Math.max(to, outcome.range.to ?? outcome.range.from);
        }

        // A claim nothing reported a range under acts nowhere the timeline can show — including
        // one no call points at, which is what a claim looks like before anything is put in it.
        // Either way it is a claim about the performance with no place in it, and there is
        // nothing honest to draw.
        if (!Number.isFinite(from)) {
            stats.placelessSegments++;
            continue;
        }
        if (!Number.isFinite(to)) to = from;

        // One span per element id rather than per call: a chain may hold the same call twice —
        // the second overwrote the first's instruction and reported the same deterministic id —
        // and two identical lanes on one branch is a drawing of nothing.
        const byElement = new Map<string, Span>();
        for (const outcome of called) {
            const elements = outcome.elements.filter((id) => elementTypes.has(id));
            stats.droppedElements += outcome.elements.length - elements.length;
            if (elements.length === 0) {
                if (outcome.elements.length > 0) stats.droppedSpans++;
                continue;
            }

            const head = elements[0];
            const spanFrom = outcome.range?.from ?? from;
            const spanTo = outcome.range?.to ?? outcome.range?.from ?? to;

            const existing = byElement.get(head);
            if (!existing) {
                byElement.set(head, {
                    id: head,
                    type: elementTypes.get(head) as string,
                    from: spanFrom,
                    to: Math.max(spanFrom, spanTo),
                    elements: [...elements],
                });
                continue;
            }
            existing.from = Math.min(existing.from, spanFrom);
            existing.to = Math.max(existing.to, spanTo);
            for (const id of elements) {
                if (!existing.elements.includes(id)) existing.elements.push(id);
            }
        }

        const spans = [...byElement.values()];
        if (spans.length === 0) {
            stats.emptySegments++;
            continue;
        }

        segments.push({
            id: claim.id,
            ...(claim.note ? { note: claim.note } : {}),
            from,
            to: Math.max(from, to),
            spans,
        });
    }

    return { reconstruction: { title, author, segments }, stats };
}

/**
 * What the projection had to leave out.
 *
 * Reported rather than logged: a reconstruction quietly losing a third of its gestures looks
 * exactly like one that never had them, and the editor should be able to say which it is.
 */
export interface ProjectionStats {
    /** Calls claimed under no segment — or under one this file no longer holds. No span. */
    ungroupedCalls: number;
    /** Element ids a later call removed from the document again. */
    droppedElements: number;
    /** Calls whose every element was removed again. */
    droppedSpans: number;
    /** Groups left with no gesture at all. */
    emptySegments: number;
    /**
     * Claims with nowhere on the timeline to draw them: no call points at them at all, or none
     * of the calls that do reported a range.
     */
    placelessSegments: number;
}
