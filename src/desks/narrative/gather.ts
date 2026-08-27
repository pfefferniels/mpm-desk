import type { Call, Segment } from '../../model/Work';
import type { Instruction } from './InstructionChips';

/** What one segment holds: the instructions still in the document, and a count of those gone. */
interface Held {
    instructions: Instruction[];
    /**
     * Instructions its calls wrote that a later call removed or merged away again.
     *
     * Counted rather than drawn. There is no element left to point at, and the one thing a
     * drawing of the document cannot show is what the document no longer holds.
     */
    overwritten: number;
}

interface Gathered {
    bySegment: Map<string, Held>;
    /** Instructions whose call names no segment, or names one this file no longer holds. */
    ungrouped: Instruction[];
}

/**
 * Read the narrative off the work file: segment → its calls → what they wrote.
 *
 * The whole desk is a view of this. It runs the other way from how the file is written — the
 * calls name the segment, so gathering means one pass over the calls rather than a lookup per
 * segment — and it settles three things a row cannot settle for itself:
 *
 * - **What a segment holds at all.** A call that wrote no instruction contributes nothing, which
 *   is the whole of "`Modify`, `MakeChoice` and `TranslatePhyiscalTimeToTicks` are not part of
 *   the narrative": they are left out by having nothing to show, not by anyone keeping a list of
 *   which transformers count.
 * - **Which instructions are gone.** `Call.elements` records what a call was answerable for when
 *   it ran; the document may since have merged or removed one. Anything `typeById` has no entry
 *   for is counted as overwritten instead.
 * - **Who wrote what.** `Call.elements` is derived by diffing the document before and after the
 *   call, so it credits reshaping as readily as writing — `StylizeOrnamentation` points all 100
 *   ornaments at shared `<ornamentDef>`s and is answerable for all 100. The call that put an
 *   instruction there first is the one that *wrote* it; every later claimant reshaped it. That
 *   needs the chain in order, so it is settled here rather than per row.
 */
export function gatherInstructions(
    segments: readonly Segment[],
    calls: readonly Call[],
    typeById: ReadonlyMap<string, string>,
): Gathered {
    const held = new Set(segments.map((segment) => segment.id));

    const firstAuthor = new Map<string, string>();
    for (const call of calls) {
        for (const id of call.elements ?? []) {
            if (!firstAuthor.has(id)) firstAuthor.set(id, call.id);
        }
    }

    const bySegment = new Map<string, Held>();
    for (const segment of segments) bySegment.set(segment.id, { instructions: [], overwritten: 0 });
    const ungrouped: Instruction[] = [];

    // One `seen` per destination rather than one overall: an instruction two calls of the same
    // segment are both answerable for is one chip, but the same instruction reshaped by a call
    // in another segment is that segment's business too.
    const seen = new Map<string, Set<string>>();
    const seenIn = (key: string) => {
        const existing = seen.get(key);
        if (existing) return existing;
        const fresh = new Set<string>();
        seen.set(key, fresh);
        return fresh;
    };

    for (const call of calls) {
        const into =
            call.segment !== undefined && held.has(call.segment)
                ? bySegment.get(call.segment)
                : undefined;
        const list = into?.instructions ?? ungrouped;
        const already = seenIn(call.segment !== undefined && into ? call.segment : '');

        for (const id of call.elements ?? []) {
            const type = typeById.get(id);
            if (type === undefined) {
                if (into) into.overwritten += 1;
                continue;
            }
            if (already.has(id)) continue;
            already.add(id);
            list.push({
                id,
                type,
                call: call.id,
                callName: call.name,
                written: firstAuthor.get(id) === call.id,
            });
        }
    }

    return { bySegment, ungrouped };
}
