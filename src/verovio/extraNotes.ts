/**
 * The played notes with no note in the score, drawn where they were played.
 *
 * There is no note in the document for verovio to draw, so the alternative is a
 * table of times and pitches. But the fork lays the score out along performed
 * time, so an extra note has a place on the axis every other note is on: reading
 * a trill as "seven rows at 0:14.2" is guesswork, seeing seven crosses on the
 * note they decorate is not.
 *
 * The geometry follows ./extenders, which draws release lines the same way: take
 * a note verovio has placed and measure from it. Its notehead gives a point
 * whose performed time is known from `data-perf-onset`, so seconds convert
 * through `unitsPerSecond`, and its `data-pname` and `data-oct` give a diatonic
 * step, so steps convert through half a staff space. Nothing has to be assumed
 * about where verovio put its origin.
 */

import { staffSpace, unitsPerSecond, type ScoreOptions } from "./toolkit";
import { spellMidi } from "../performance/spellPitch";

const SVG_NS = "http://www.w3.org/2000/svg";
const EXTRA_CLASS = "performanceExtraNote";

/** The colour of a note that was played and is not written anywhere */
export const EXTRA_COLOUR = "#15803d";

/** Where C stands in a diatonic octave, so that a step can be counted from a name */
const STEPS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 } as const;

export interface ExtraNote {
    /** The performed note's own id, so a click can be traced back to it */
    id: string;
    /** The divergence it belongs to, which is what a click selects */
    divergenceId: string;
    onsetMs: number;
    offsetMs: number;
    pitch: number;
    /** Drawn faintly until the reader has said what it is */
    resolved: boolean;
}

export interface ExtraNoteOptions {
    /** The key the extra notes are spelled in, so an F sharp is not drawn as a G flat */
    tonic?: string;
    colour?: string;
}

export function clearExtraNotes(root: Element): void {
    root.querySelectorAll(`.${EXTRA_CLASS}`).forEach((note) => note.remove());
}

/**
 * A note verovio has placed, with everything needed to measure from it.
 *
 * Only notes carrying a performed time are usable: an unmatched one is placed by
 * interpolation and would put the whole system's measurements out.
 */
interface Reference {
    x: number;
    y: number;
    onsetMs: number;
    step: number;
    staff: Element;
}

function referencesIn(system: Element): Reference[] {
    const references: Reference[] = [];

    for (const note of system.querySelectorAll(".note")) {
        const onset = note.getAttribute("data-perf-onset");
        const pname = note.getAttribute("data-pname")?.toLowerCase();
        const oct = note.getAttribute("data-oct");
        if (!onset || !pname || !oct || !(pname in STEPS)) continue;

        const translate = note
            .querySelector(".notehead use")
            ?.getAttribute("transform")
            ?.match(/translate\(\s*([-0-9.]+)[\s,]+([-0-9.]+)/);
        if (!translate) continue;

        const staff = note.closest(".staff");
        if (!staff) continue;

        references.push({
            x: Number(translate[1]),
            y: Number(translate[2]),
            onsetMs: Number(onset),
            step: Number(oct) * 7 + STEPS[pname as keyof typeof STEPS],
            staff,
        });
    }

    return references;
}

/**
 * Draw each extra note as a cross on the staff it would have been written on.
 *
 * A cross rather than a notehead on purpose: these notes are not in the score,
 * and drawing them as though they were would be a claim the alignment has not
 * earned. The reader decides that, and only then does the note get written.
 */
export function drawExtraNotes(
    root: Element,
    notes: readonly ExtraNote[],
    options?: Partial<ScoreOptions> & ExtraNoteOptions
): void {
    clearExtraNotes(root);
    if (notes.length === 0) return;

    const perSecond = unitsPerSecond(options);
    const space = staffSpace(options);
    const tonic = options?.tonic ?? "C";
    const colour = options?.colour ?? EXTRA_COLOUR;

    // Each system's notes, read once. A note is drawn on exactly one of them:
    // the spans overlap by design, so that a note played just after the last
    // written note of a system still has somewhere to go, and iterating systems
    // outermost would draw such a note twice.
    const systems = [...root.querySelectorAll(".system")]
        .map((system) => referencesIn(system))
        .filter((references) => references.length > 0)
        .map((references) => ({ references, span: performedSpanOf(references) }));

    if (systems.length === 0) return;

    for (const note of notes) {
        const step = diatonicStep(note.pitch, tonic);
        if (step === undefined) continue;

        const system = systemFor(systems, note.onsetMs);
        if (!system) continue;

        // Measure from the reference nearest in pitch on the staff that note
        // would belong to, which keeps the extrapolation short
        const reference = nearestReference(system.references, note.onsetMs, step);
        if (!reference) continue;

        const x = reference.x + ((note.onsetMs - reference.onsetMs) / 1000) * perSecond;
        const y = reference.y - (step - reference.step) * (space / 2);

        reference.staff.appendChild(
            cross(reference.staff.ownerDocument, note, x, y, space, colour)
        );
    }
}

interface System {
    references: Reference[];
    span: { from: number; to: number };
}

/**
 * The one system a played note belongs on: the one whose own notes it falls
 * among, and where two overlap, whichever holds the moment more squarely.
 */
function systemFor(systems: System[], onsetMs: number): System | undefined {
    let best: System | undefined;
    let bestCost = Infinity;

    for (const system of systems) {
        if (onsetMs < system.span.from || onsetMs > system.span.to) continue;

        const middle = (system.span.from + system.span.to) / 2;
        const cost = Math.abs(onsetMs - middle);
        if (cost < bestCost) {
            bestCost = cost;
            best = system;
        }
    }

    return best;
}

/**
 * Where a played pitch stands on the staff, counted in diatonic steps from C0.
 *
 * The pitch has to be spelled first: whether an F sharp is drawn on the F line
 * or the G space is a matter of the key, not of the MIDI number, and `spellMidi`
 * is what the rest of the project already asks. Its `name` is letter, accidental
 * and octave run together, which is what is taken apart here.
 */
function diatonicStep(pitch: number, tonic: string): number | undefined {
    const parsed = spellMidi(pitch, tonic).name.match(/^([A-G])([#b]*)(-?\d+)$/);
    if (!parsed) return undefined;

    const letter = parsed[1].toLowerCase() as keyof typeof STEPS;
    return Number(parsed[3]) * 7 + STEPS[letter];
}

/** The stretch of performed time a system covers, from the notes drawn on it. */
function performedSpanOf(references: Reference[]): { from: number; to: number } {
    let from = Infinity;
    let to = -Infinity;
    for (const reference of references) {
        if (reference.onsetMs < from) from = reference.onsetMs;
        if (reference.onsetMs > to) to = reference.onsetMs;
    }

    // A note played after the last written note of a system, but before the first
    // of the next, still belongs here
    return { from: from - 2000, to: to + 2000 };
}

/**
 * The note to measure from: the one nearest in pitch, and among those the
 * nearest in time. Pitch decides the staff, and a cross measured from a note on
 * the wrong staff of a grand staff would be an octave or more out.
 */
function nearestReference(
    references: Reference[],
    onsetMs: number,
    step: number
): Reference | undefined {
    let best: Reference | undefined;
    let bestCost = Infinity;

    for (const reference of references) {
        // Pitch dominates: a whole octave of drift costs less than the wrong staff
        const cost =
            Math.abs(reference.step - step) * 1000 + Math.abs(reference.onsetMs - onsetMs) / 1000;
        if (cost < bestCost) {
            bestCost = cost;
            best = reference;
        }
    }

    return best;
}

function cross(
    doc: Document,
    note: ExtraNote,
    x: number,
    y: number,
    space: number,
    colour: string
): Element {
    const group = doc.createElementNS(SVG_NS, "g");
    group.setAttribute("class", EXTRA_CLASS);
    group.setAttribute("data-perf-id", note.id);
    group.setAttribute("data-divergence", note.divergenceId);
    group.setAttribute("opacity", note.resolved ? "1" : "0.75");
    group.setAttribute("style", "cursor: pointer");

    const arm = space * 0.45;
    const mark = doc.createElementNS(SVG_NS, "path");
    mark.setAttribute(
        "d",
        `M${x - arm} ${y - arm} L${x + arm} ${y + arm} M${x - arm} ${y + arm} L${x + arm} ${y - arm}`
    );
    mark.setAttribute("fill", "none");
    // As a style rather than an attribute, because verovio puts a rule of its own
    // into every SVG it renders - `#<id> path { stroke: currentColor }` - and an
    // id selector outranks any presentation attribute. An inline style outranks
    // the rule in turn, while still giving way to the `!important` a view paints
    // a selected mark with.
    mark.setAttribute("stroke", colour);
    (mark as SVGElement).style.setProperty("stroke", colour);
    mark.setAttribute("stroke-width", String(space / 5));
    group.appendChild(mark);

    const title = doc.createElementNS(SVG_NS, "title");
    title.textContent = "Played, with no note in the score";
    group.appendChild(title);

    return group;
}
