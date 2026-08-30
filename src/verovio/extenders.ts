import { staffSpace, unitsPerSecond, type ScoreOptions } from "./toolkit";

const SVG_NS = "http://www.w3.org/2000/svg";
const EXTENDER_CLASS = "performanceExtender";

/** A notehead is about this wide, in staff spaces - where the line may start */
const NOTEHEAD_WIDTH = 1.18;

/** How far the tick closing the line reaches above and below it, in staff spaces */
const RELEASE_TICK = 0.3;

function anchorOf(note: Element): [number, number] | undefined {
    const translate = note
        .querySelector(".notehead use")
        ?.getAttribute("transform")
        ?.match(/translate\(\s*([-0-9.]+)[\s,]+([-0-9.]+)/);

    return translate ? [Number(translate[1]), Number(translate[2])] : undefined;
}

/**
 * Where the staves of a system end, which is as far as a line may reach: a note
 * still held when the system breaks is cut off rather than drawn into the margin.
 */
function rightEdgeOf(system: Element): number {
    const ends = [...system.querySelectorAll(".staff > path")].map((line) =>
        Number(line.getAttribute("d")?.match(/L\s*([-0-9.]+)/)?.[1] ?? NaN)
    );

    return Math.max(...ends.filter((end) => !Number.isNaN(end)));
}

export function clearExtenders(root: Element): void {
    root.querySelectorAll(`.${EXTENDER_CLASS}`).forEach((line) => line.remove());
}

/**
 * Draw how long each note was held: a line from its notehead to the point where
 * the recording released it.
 *
 * The line is added inside the note it belongs to, which puts it in the same
 * coordinate system as the notehead and, since velocity is rendered as the
 * opacity of that group, gives it the same ink density as the note itself.
 */
export function drawExtenders(root: Element, options?: Partial<ScoreOptions>): void {
    clearExtenders(root);

    const perSecond = unitsPerSecond(options);
    const space = staffSpace(options);
    const head = space * NOTEHEAD_WIDTH;

    const edges = new Map<Element, number>();

    for (const note of root.querySelectorAll(".note")) {
        const onset = note.getAttribute("data-perf-onset");
        const offset = note.getAttribute("data-perf-offset");
        if (!onset || !offset) continue;

        const anchor = anchorOf(note);
        if (!anchor) continue;

        const system = note.closest(".system");
        if (system && !edges.has(system)) edges.set(system, rightEdgeOf(system));

        const [x, y] = anchor;
        const held = (Number(offset) - Number(onset)) / 1000;
        const released = x + held * perSecond;
        const end = Math.min(released, edges.get(system!) ?? Infinity);
        if (end <= x + head) continue;

        // The tick closes the line where the note was let go. A line that ran into
        // the end of its system does not get one - nothing was released there
        const tick = space * RELEASE_TICK;
        const stroke = `M${x + head} ${y} H${end}`;
        const close = end < released ? "" : ` M${end} ${y - tick} V${y + tick}`;

        const line = note.ownerDocument.createElementNS(SVG_NS, "path");
        line.setAttribute("class", EXTENDER_CLASS);
        line.setAttribute("d", stroke + close);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", "currentColor");
        line.setAttribute("stroke-width", String(space / 6));
        line.setAttribute("opacity", "0.6");
        note.appendChild(line);
    }
}
