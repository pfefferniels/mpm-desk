/**
 * Which segments are sounding at a moment of playback.
 *
 * The one rule the viewer's tree and the narrative desk share for following the playhead: a
 * segment is lit while any instruction it claims is in effect — `effectiveAt`, kind by kind —
 * so a `<tempo>` keeps its word lit until the next tempo replaces it, and an ornament lights
 * its word only for the notes it sits on. Kept in one place so that a table row and a word on
 * the line light up at the same moment for the same reason.
 */
import type { Segment } from "../model/Reconstruction";
import type { PerformanceReader } from "../utils/mpm";

/** Every kind of instruction a segment can be made of — the kinds the playhead asks after. */
const SOUNDING_TYPES = [
    "tempo",
    "dynamics",
    "rubato",
    "articulation",
    "asynchrony",
    "movement",
    "ornament",
    "accentuationPattern",
] as const;

/**
 * MPM element id ⇒ the segment that claims it.
 *
 * An instruction one claim wrote and another reshaped is listed under both; the later of the
 * two in `segments` wins here, which is the one the tree has drawn it under all along.
 */
export function elementOwners(segments: readonly Segment[]): Map<string, string> {
    const owners = new Map<string, string>();
    for (const segment of segments) {
        for (const span of segment.spans) {
            for (const element of span.elements) owners.set(element, segment.id);
        }
    }
    return owners;
}

/** The segments with an instruction in effect at `date`, by {@link elementOwners}. */
export function segmentsSoundingAt(
    mpm: PerformanceReader,
    date: number,
    owners: ReadonlyMap<string, string>,
): Set<string> {
    const sounding = new Set<string>();
    for (const type of SOUNDING_TYPES) {
        for (const instruction of mpm.effectiveAt(date, type)) {
            const owner = owners.get(instruction.id);
            if (owner !== undefined) sounding.add(owner);
        }
    }
    return sounding;
}
