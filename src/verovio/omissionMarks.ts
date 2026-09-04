/**
 * A passage the performer left out, marked rather than drawn.
 *
 * The score is laid out along the time it was performed in, so a note takes as
 * much room as it took to play and a note never played takes none. The fork
 * places such a note between the two matched notes on either side, so a skipped
 * phrase arrives in the width of one notehead, four bars on top of each other,
 * unreadable in the way that looks like a rendering fault.
 *
 * So a crowded group is taken out and a bracket put in its place, holding the
 * number of notes passed over. The bracket is the same size wherever it stands:
 * only the count says how much music is inside it.
 *
 * A group whose notes do have room keeps them, with the bracket around them. The
 * measuring is done on what verovio actually drew, so this needs no opinion
 * about tempo, scale or how long the omission was.
 *
 * What counts as a passage worth bracketing at all is not decided here - that is
 * a reading of the music, and the caller holds it. This draws what it is given.
 */

import { staffSpace, type ScoreOptions } from "./toolkit";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARK_CLASS = "performanceOmission";
/** Marks the notes this module has taken out, so that it can put them back */
const HIDDEN_ATTRIBUTE = "data-omitted";

/** The colour of a note the performer did not play */
export const OMITTED_COLOUR = "#dc2626";

/**
 * How much room a group needs before its notes are left visible: this much of a
 * staff space between one notehead and the next, on average. Below it they are
 * touching, and the bracket says more than they do.
 */
const ROOM_PER_NOTE = 0.9;

export interface OmittedGroup {
    /** The divergence, so that a click on the mark asks about it */
    divergenceId: string;
    /** The written notes that went unplayed, in sounding order */
    scoreIds: readonly string[];
    /** Drawn faintly until the reader has said what it is */
    resolved: boolean;
}

export function clearOmissionMarks(root: Element): void {
    root.querySelectorAll(`.${MARK_CLASS}`).forEach((mark) => mark.remove());
    for (const note of root.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) {
        (note as SVGElement).style.removeProperty("display");
        note.removeAttribute(HIDDEN_ATTRIBUTE);
    }
}

/** A note verovio has drawn, and where on which staff it drew it. */
interface Placed {
    note: Element;
    x: number;
    y: number;
    staff: Element;
}

const escaped = (id: string) =>
    typeof CSS?.escape === "function" ? CSS.escape(id) : id;

function placed(root: Element, id: string): Placed | undefined {
    const note = root.querySelector(`[data-id="${escaped(id)}"]`);
    if (!note) return undefined;

    const translate = note
        .querySelector(".notehead use")
        ?.getAttribute("transform")
        ?.match(/translate\(\s*([-0-9.]+)[\s,]+([-0-9.]+)/);
    const staff = note.closest(".staff");
    if (!translate || !staff) return undefined;

    return { note, x: Number(translate[1]), y: Number(translate[2]), staff };
}

export function drawOmissionMarks(
    root: Element,
    groups: readonly OmittedGroup[],
    options?: Partial<ScoreOptions> & { colour?: string }
): void {
    clearOmissionMarks(root);
    if (groups.length === 0) return;

    const space = staffSpace(options);
    const colour = options?.colour ?? OMITTED_COLOUR;
    /** Staves that lost notes, swept once at the end for what those notes held up */
    const emptied = new Set<Element>();

    for (const group of groups) {
        const notes = group.scoreIds
            .map((id) => placed(root, id))
            .filter((note): note is Placed => note !== undefined);
        if (notes.length < 2) continue;

        // Whether there is room is a fact about the group, not about each staff
        // it happens to reach onto: an omission spanning both hands is one event
        // and is either legible or not as a whole
        const xs = notes.map((note) => note.x);
        const extent = Math.max(...xs) - Math.min(...xs);
        const crowded = extent < (notes.length - 1) * space * ROOM_PER_NOTE;

        const staves = new Map<Element, Placed[]>();
        for (const note of notes) {
            const on = staves.get(note.staff) ?? [];
            on.push(note);
            staves.set(note.staff, on);
        }

        for (const [staff, on] of staves) {
            if (crowded) {
                for (const note of on) {
                    (note.note as SVGElement).style.display = "none";
                    note.note.setAttribute(HIDDEN_ATTRIBUTE, group.divergenceId);
                }
                emptied.add(staff);
            }

            staff.appendChild(
                bracket(staff, on, {
                    group,
                    space,
                    colour,
                    // Only where the notes have been taken out: where they are
                    // still there, they can be counted
                    count: crowded ? notes.length : undefined,
                })
            );
        }
    }

    // Once, and after every group has gone: a beam is only an orphan when the
    // last of the notes it joins has been taken out, whichever group took it
    for (const staff of emptied) hideOrphans(staff);
}

/**
 * Everything left behind by notes that have been taken out.
 *
 * A notehead is not all verovio draws for a note. The stem of a chord belongs to
 * the chord and not to either note of it, a beam belongs to the group it joins,
 * and a ledger line is drawn at the staff and only points back at the note it is
 * for. Take the notes out and those stay behind: a stem holding nothing up, a
 * beam over a gap. So anything whose notes have all gone goes with them, and
 * anything with a note still standing is left exactly where it was.
 */
function hideOrphans(staff: Element): void {
    const gone = (note: Element) => note.hasAttribute(HIDDEN_ATTRIBUTE);

    for (const group of staff.querySelectorAll(".chord, .beam, .tuplet")) {
        const notes = [...group.querySelectorAll(".note")];
        if (notes.length > 0 && notes.every(gone)) {
            (group as SVGElement).style.display = "none";
            group.setAttribute(HIDDEN_ATTRIBUTE, "");
        }
    }

    for (const line of staff.querySelectorAll("[data-related]")) {
        const related = line.getAttribute("data-related")?.replace(/^#/, "");
        const note = related && staff.querySelector(`[data-id="${escaped(related)}"]`);
        if (note && gone(note)) {
            (line as SVGElement).style.display = "none";
            line.setAttribute(HIDDEN_ATTRIBUTE, "");
        }
    }
}

/** Where the staff's own lines run, which is what a bracket is sized against. */
function staffExtent(staff: Element): { top: number; bottom: number } | undefined {
    const ys = [...staff.children]
        .filter((child) => child.tagName === "path")
        .map((line) => Number(line.getAttribute("d")?.match(/^M[\s]*[-0-9.]+\s+([-0-9.]+)/)?.[1]))
        .filter((y) => Number.isFinite(y));

    if (ys.length === 0) return undefined;
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

function bracket(
    staff: Element,
    on: Placed[],
    {
        group,
        space,
        colour,
        count,
    }: { group: OmittedGroup; space: number; colour: string; count?: number }
): Element {
    const doc = staff.ownerDocument;
    const xs = on.map((note) => note.x);
    const ys = on.map((note) => note.y);

    // The staff if it can be read, and the notes themselves if it cannot: a
    // bracket has to reach past whatever it holds either way
    const lines = staffExtent(staff);
    const top = Math.min(lines?.top ?? Infinity, Math.min(...ys)) - space * 0.5;
    const bottom = Math.max(lines?.bottom ?? -Infinity, Math.max(...ys)) + space * 0.5;

    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    // A notehead is drawn to the right of the point it is placed at, so a
    // bracket holding notes needs more room on its closing side than its opening
    // one. A bracket standing in for notes that have been taken out is its own
    // fixed width, which is the point of it: nothing about the size says how much
    // music is inside.
    const left = count === undefined ? Math.min(...xs) - space * 0.7 : middle - space * 0.8;
    const right = count === undefined ? Math.max(...xs) + space * 1.7 : middle + space * 0.8;
    const serif = space * 0.35;

    const mark = doc.createElementNS(SVG_NS, "g");
    mark.setAttribute("class", MARK_CLASS);
    mark.setAttribute("data-divergence", group.divergenceId);
    mark.setAttribute("opacity", group.resolved ? "1" : "0.8");
    mark.setAttribute("style", "cursor: pointer");

    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute(
        "d",
        `M${left + serif} ${top} L${left} ${top} L${left} ${bottom} L${left + serif} ${bottom} ` +
            `M${right - serif} ${top} L${right} ${top} L${right} ${bottom} L${right - serif} ${bottom}`
    );
    path.setAttribute("fill", "none");
    // A bracket is three sides of a rectangle, so anything that paints the whole
    // mark - the style that marks what the reader has open, say - would close it
    // into a filled bar. An inline important is the one thing that outranks such
    // a rule, and the stroke is left free to take its colour.
    (path as SVGElement).style.setProperty("fill", "none", "important");
    // Not as an attribute alone: verovio renders `#<id> path { stroke: currentColor }`
    // into every SVG, and an id selector outranks a presentation attribute. An
    // inline style outranks the rule, and still gives way to the `!important` a
    // selected mark is painted with.
    path.setAttribute("stroke", colour);
    (path as SVGElement).style.setProperty("stroke", colour);
    path.setAttribute("stroke-width", String(space / 5));
    mark.appendChild(path);

    if (count !== undefined) {
        const label = doc.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(middle));
        label.setAttribute("y", String(top - space * 0.4));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("fill", colour);
        label.setAttribute("font-size", String(space));
        label.setAttribute("font-family", "sans-serif");
        label.textContent = String(count);
        mark.appendChild(label);
    }

    const title = doc.createElementNS(SVG_NS, "title");
    title.textContent = `${count ?? on.length} notes the recording does not play`;
    mark.appendChild(title);

    return mark;
}
