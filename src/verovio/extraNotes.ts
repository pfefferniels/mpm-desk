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
 *
 * A score laid out the ordinary way has no time axis to measure along, only
 * notes. There the caller says when the notes it is sure of were struck, and a
 * played note is drawn between the two of them it fell between, as far along as
 * it was in time: the notation keeps its own spacing, and the cross still says
 * when it sounded, among the notes around it.
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

interface ExtraNoteOptions {
    /** The key the extra notes are spelled in, so an F sharp is not drawn as a G flat */
    tonic?: string;
    colour?: string;
    /**
     * When each written note to measure from was struck, in milliseconds, by its id.
     *
     * Given, the score is taken to be laid out the ordinary way and these notes are the
     * anchors a played note is placed between. Without it, the layout is the performed one
     * and every note's time is read off the drawing.
     */
    struck?: ReadonlyMap<string, number>;
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

/**
 * The notes of a system that say where a pitch stands on a staff. Every note does, whether or
 * not its moment is known: the moment is the other question.
 */
type Pitched = Omit<Reference, "onsetMs"> & { onsetMs?: number };

function referencesIn(system: Element, struck?: ReadonlyMap<string, number>): Pitched[] {
    const references: Pitched[] = [];

    for (const note of system.querySelectorAll(".note")) {
        const onset = struck
            ? struck.get(note.getAttribute("data-id") ?? "")
            : note.getAttribute("data-perf-onset") ?? undefined;
        const pname = note.getAttribute("data-pname")?.toLowerCase();
        const oct = note.getAttribute("data-oct");
        if (!pname || !oct || !(pname in STEPS)) continue;

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
            ...(onset !== undefined && onset !== "" && { onsetMs: Number(onset) }),
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
        .map((system) => {
            const pitched = referencesIn(system, options?.struck);
            const references = pitched.filter((note): note is Reference => note.onsetMs !== undefined);
            return { pitched, references };
        })
        .filter(({ references }) => references.length > 0)
        .map(({ pitched, references }) => ({
            pitched,
            references,
            span: performedSpanOf(references),
            xAt: options?.struck ? timelineOf(references, space) : undefined,
        }));

    if (systems.length === 0) return;

    for (const note of notes) {
        const step = diatonicStep(note.pitch, tonic);
        if (step === undefined) continue;

        const system = systemFor(systems, note.onsetMs);
        if (!system) continue;

        let x: number;
        let reference: Pitched | undefined;
        if (system.xAt) {
            // Where it goes along the system is a question of time, and the notes whose
            // moments are known answer it. Where it goes up and down is a question of pitch,
            // which any note near it answers, and the nearer the better: a clef can change
            x = system.xAt(note.onsetMs);
            reference = nearestPitched(system.pitched, x, step);
        } else {
            // Measure from the reference nearest in pitch on the staff that note
            // would belong to, which keeps the extrapolation short
            const timed = nearestReference(system.references, note.onsetMs, step);
            reference = timed;
            x = timed ? timed.x + ((note.onsetMs - timed.onsetMs) / 1000) * perSecond : NaN;
        }
        if (!reference) continue;
        const y = reference.y - (step - reference.step) * (space / 2);

        reference.staff.appendChild(
            cross(reference.staff.ownerDocument, note, x, y, space, colour)
        );
    }
}

interface System {
    /** Every note on it, for where a pitch stands */
    pitched: Pitched[];
    /** The notes on it whose moments are known */
    references: Reference[];
    span: { from: number; to: number };
    /** Where a moment falls on a system laid out the ordinary way */
    xAt?: (ms: number) => number;
}

/**
 * Where a moment falls on a system laid out the ordinary way, read off the notes on it whose
 * moments are known.
 *
 * One point per place in the bar: the notes drawn at one horizontal position were written to
 * be struck together, and a chord spread over a fifth of a second still stands in one place,
 * so the place takes the middle of the moments they were struck at. A place struck earlier than
 * the one before it is left out, so that a moment never runs backwards along the staff. Between
 * two places a moment falls in proportion. Beyond the first or the last it goes on at the pace
 * of the nearest two, but not past the music on the system: a note played after the last one a
 * system holds is drawn at its end rather than in the margin.
 */
export function timelineOf(
    references: readonly { x: number; onsetMs: number }[],
    space: number
): (ms: number) => number {
    const byPlace = new Map<number, number[]>();
    for (const { x, onsetMs } of references) {
        const place = Math.round(x);
        const at = byPlace.get(place);
        if (at) at.push(onsetMs);
        else byPlace.set(place, [onsetMs]);
    }

    const points: { x: number; ms: number }[] = [];
    for (const [x, struck] of [...byPlace].sort(([a], [b]) => a - b)) {
        struck.sort((a, b) => a - b);
        const middle =
            struck.length % 2 === 1
                ? struck[(struck.length - 1) / 2]
                : (struck[struck.length / 2 - 1] + struck[struck.length / 2]) / 2;
        const last = points.at(-1);
        if (last && middle < last.ms) continue;
        points.push({ x, ms: middle });
    }

    const first = points[0];
    const last = points[points.length - 1];
    const from = first.x - 2 * space;
    const to = last.x + 2 * space;
    const along = (a: { x: number; ms: number }, b: { x: number; ms: number }, ms: number) =>
        b.ms === a.ms ? a.x : a.x + ((ms - a.ms) / (b.ms - a.ms)) * (b.x - a.x);

    return (ms: number): number => {
        if (points.length === 1) return Math.min(to, Math.max(from, first.x));
        if (ms <= first.ms) return Math.max(from, along(first, points[1], ms));
        if (ms >= last.ms) return Math.min(to, along(points[points.length - 2], last, ms));
        let after = 1;
        while (points[after].ms < ms) after++;
        return along(points[after - 1], points[after], ms);
    };
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

/** The note nearest in pitch to measure a pitch from, and among those the nearest along. */
function nearestPitched(notes: readonly Pitched[], x: number, step: number): Pitched | undefined {
    let best: Pitched | undefined;
    let bestCost = Infinity;
    for (const note of notes) {
        // Pitch dominates, as below: the wrong staff of a grand staff is an octave or more out
        const cost = Math.abs(note.step - step) * 1e6 + Math.abs(note.x - x);
        if (cost < bestCost) {
            bestCost = cost;
            best = note;
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
