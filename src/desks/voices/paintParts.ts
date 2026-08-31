import { colorForPart, PART_COLORS, UNASSIGNED } from './partColors';

/**
 * Colour a rendered score by the part each note is in.
 *
 * Writes an *attribute* per note and lets the cascade do the rest, rather than an inline style: an
 * inline `fill` would beat every rule below it and force every state — selected, faded, unaligned —
 * to be repainted explicitly. So a palette change is a stylesheet swap and a selection change is a
 * class toggle, and neither re-runs verovio.
 *
 * It adds and removes no nodes. That is what lets `Score` re-run it from a `MutationObserver`
 * without the pass hearing itself.
 */
export const paintParts = (
    root: ParentNode,
    partOf: ReadonlyMap<string, number>,
    selected: ReadonlySet<string>,
    isolated: number | undefined,
): void => {
    for (const note of root.querySelectorAll('g.note')) {
        const id = note.getAttribute('data-id');
        if (!id) continue;

        const part = partOf.get(id);
        if (part === undefined) note.removeAttribute('data-part');
        else note.setAttribute('data-part', String(part));

        note.classList.toggle('voice-selected', selected.has(id));
        note.classList.toggle('voice-faded', isolated !== undefined && part !== isolated);
    }
};

/**
 * The stylesheet the attributes above are read by.
 *
 * Both `fill` and `color` on every rule: verovio's own sheet says `path, rect, polygon { stroke:
 * currentColor }`, so a notehead takes its colour from `fill` while the stem and beam take theirs
 * from `color`. Setting one and not the other paints half a note, which is exactly why the fork's
 * `SetCustomGraphicColor` sets both.
 *
 * @param haloWidth the selection outline's width, in the units the SVG is drawn in — a fraction of
 * `staffSpace`, so it scales with the score rather than with a literal.
 */
export const partStyles = (haloWidth: number): string =>
    [
        ...PART_COLORS.map(
            (_, index) =>
                `g.note[data-part="${String(index + 1)}"] { fill: ${colorForPart(index + 1)}; color: ${colorForPart(index + 1)}; }`,
        ),
        `g.note:not([data-part]) { fill: ${UNASSIGNED}; color: ${UNASSIGNED}; }`,
        `g.note.voice-selected .notehead use { stroke: #111827; stroke-width: ${String(haloWidth)}; paint-order: stroke; }`,
        `g.note.voice-faded { opacity: .18; }`,
    ].join('\n');
