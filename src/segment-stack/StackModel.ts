import type { Segment, Span } from "../model/Reconstruction";
import { CHAR_WIDTH_RATIO } from "./words";

/**
 * The tick span a point-like segment is drawn as, so it responds to zoom
 * naturally: small when zoomed out, wider when zoomed in.
 */
export function pointSpanFallback(segments: Segment[]): number {
    const spans = segments.map(s => s.to - s.from).filter(s => s > 0);
    if (spans.length === 0) return 0;
    spans.sort((a, b) => a - b);
    return spans[Math.floor(spans.length / 4)]; // first quartile
}

/**
 * The tick range a segment or span covers: clamped to the piece, and given width
 * if it has none.
 *
 * One segment in the corpus starts at -100, and three act on a single point.
 * Ticks may be fractional, so this is geometry only — never an array index.
 *
 * Used for drawing and for previewing: a point-like gesture has to be given the
 * same width to be heard as it is to be seen.
 */
export function tickRange(over: { from: number; to: number }, minPointSpan: number): { from: number; to: number } {
    const from = Math.max(0, over.from);
    const to = over.to > from ? over.to : from + Math.max(1, minPointSpan);
    return { from, to };
}

/**
 * How many rungs of the packing ladder there are to a doubling of the zoom.
 *
 * Six puts them about 12% apart, which is finer than the clearance the packer
 * works to, so a rung is never visibly the wrong shape for the zoom it is shown
 * at.
 */
const PACK_RUNGS_PER_OCTAVE = 6;

/**
 * The zoom the tree is packed at: the rung at or below the zoom it is drawn at.
 *
 * Where a branch sits is a question about what else is near it, so the packing
 * is the one part of the drawing that has to answer to zoom — and the only part
 * that costs real time. Holding it on a ladder means a zoom step usually just
 * slides the branches along their line, which the browser does at frame rate,
 * and the tree only re-forms once the crowding has actually changed.
 *
 * Downwards, never to the nearest: a rung packs as though the view were further
 * out than it is, so between rungs the feet are further apart than the packer
 * allowed for rather than closer. Rounding the other way would let two words
 * that were only just clear of each other overprint.
 *
 * It also makes the layout a function of the rung alone, so zooming out and
 * back in returns the tree you left rather than a reshuffled one.
 */
export function packZoom(stretchX: number): number {
    if (!(stretchX > 0)) return stretchX;
    const rung = Math.floor(Math.log2(stretchX) * PACK_RUNGS_PER_OCTAVE);
    return 2 ** (rung / PACK_RUNGS_PER_OCTAVE);
}

const FADE_MIN_PX = 24;
const FADE_SPAN_PX = 60;
/**
 * The faintest a gesture ever gets.
 *
 * Every branch has to stay readable at every zoom, so this is a floor on the
 * writing rather than a way of hiding it: pale enough that the long gestures
 * still carry the shape of the piece, dark enough that a short one is a word
 * you can read and not a smudge.
 */
const FADE_FLOOR = 0.45;

/**
 * How solid each segment reads at this zoom.
 *
 * Every segment is always drawn — this only fades the small gestures back as the
 * view pulls out, so the long ones carry the shape and the detail arrives as you
 * come closer.
 */
export function fadeOpacities(params: {
    segments: Segment[];
    stretchX: number;
    minPointSpan: number;
}): Map<string, number> {
    const { segments, stretchX, minPointSpan } = params;

    const map = new Map<string, number>();

    for (const s of segments) {
        const span = s.to > s.from ? s.to - s.from : minPointSpan;
        const pixels = span * stretchX;
        const t = (pixels - FADE_MIN_PX) / FADE_SPAN_PX;
        map.set(s.id, FADE_FLOOR + (1 - FADE_FLOOR) * Math.min(1, Math.max(0, t)));
    }

    return map;
}

/**
 * How many other segments strictly contain this one.
 *
 * The corpus records no nesting — segments are a flat list of overlapping tick
 * ranges — but it is there to be read: 56 stand on their own, 53 sit inside one
 * other, 18 inside two, 1 inside three. Depth is what sends a label to a side of
 * the centre line and how far out along it.
 */
export function containmentDepths(segments: Segment[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const s of segments) {
        let depth = 0;
        for (const other of segments) {
            if (other === s) continue;
            const contains = other.from <= s.from && other.to >= s.to
                && (other.from < s.from || other.to > s.to);
            if (contains) depth++;
        }
        map.set(s.id, depth);
    }
    return map;
}

/* ── How big a word is written ── */

const MIN_FONT = 8;
const MAX_FONT = 19;
/**
 * How far a branch may run before the word is set smaller to fit.
 *
 * Duration drives the type size, and the longest gestures tend to carry the
 * longest notes — so without this the two compound and one sentence set at 19px
 * reaches nearly 500px, which is most of the canvas for a single word.
 */
const MAX_BRANCH_LENGTH = 400;

/**
 * How large each segment's word is set: the longer the gesture, the bigger it
 * is written.
 *
 * Duration is the impact measure, and this is the second thing it drives after
 * nearness to the line — so a long arch of a phrase reads as a heading and the
 * small inflections inside it as fine print.
 *
 * Logarithmic, because the corpus is skewed and spans three orders of magnitude:
 * point-like gestures against phrases of 7000 ticks, with the median at 1440. A
 * linear map leaves almost everything at the bottom of the range, and the type
 * size then says nothing about the gestures that are actually being compared.
 */
export function typeScale(params: {
    segments: Segment[];
    minPointSpan: number;
    fontScale: number;
    /** How many characters the segment's word runs to. */
    charsOf: (segment: Segment) => number;
}): Map<string, number> {
    const { segments, minPointSpan, fontScale, charsOf } = params;

    const spanOf = (s: Segment) => {
        const { from, to } = tickRange(s, minPointSpan);
        return to - from;
    };
    const spans = segments.map(spanOf).filter(v => v > 0);
    const minSpan = spans.length > 0 ? Math.max(1, Math.min(...spans)) : 1;
    const maxSpan = spans.length > 0 ? Math.max(1, Math.max(...spans)) : 1;
    const decades = Math.log(maxSpan / minSpan) || 1;

    const map = new Map<string, number>();
    for (const s of segments) {
        const span = Math.max(minSpan, spanOf(s));
        const t = Math.min(1, Math.max(0, Math.log(span / minSpan) / decades));
        const byDuration = MIN_FONT + (MAX_FONT - MIN_FONT) * t;
        const toFit = MAX_BRANCH_LENGTH / Math.max(1, charsOf(s) * CHAR_WIDTH_RATIO);
        map.set(s.id, Math.max(MIN_FONT, Math.min(byDuration, toFit)) * fontScale);
    }
    return map;
}

/* ── The branch a word is written along ── */

/* ── The shape of a branch ──
 *
 * Every branch leaves the line at the same steep angle, bends over the first
 * {@link BEND_LENGTH}, and then runs on at whatever angle it has reached.
 *
 * Letting the bend *finish* — rather than spreading it over the whole word, as
 * spreading it over the whole word — is what stops a long word costing tree height in
 * proportion to how much it has to say. Past the knee a word rises by a small
 * fraction of what it adds in length, so how tall the tree stands becomes a
 * question of how many gestures overlap rather than of who wrote the longest
 * note.
 *
 * Where it comes to rest is read off the length of what it says: a short
 * gesture stands up, a long phrase lies back. That is partly economy — length
 * only costs height where there is length to spend — and partly the sound of
 * the thing, an aside against an arch.
 */

/** How steeply every branch leaves the line. */
const ARC_START_DEG = 58;
/** Where a short word comes to rest, having no length to spend on lying down. */
const KNEE_STEEP_DEG = 24;
/** Where a long one does. */
const KNEE_FLAT_DEG = 6;
/** The word lengths those two answer to; in between, the angle is interpolated. */
const KNEE_SHORT_PX = 60;
const KNEE_LONG_PX = 360;
/** How far a branch travels while it bends. Past this it runs straight. */
const BEND_LENGTH = 150;
const DEG = Math.PI / 180;

/**
 * The angle a branch of this length comes to rest at.
 *
 * Exported so the invariant can be tested rather than only asserted in a
 * comment: it is what makes two neighbouring branches of unlike length draw
 * apart instead of running side by side.
 */
export function kneeAngle(length: number): number {
    const t = (length - KNEE_SHORT_PX) / (KNEE_LONG_PX - KNEE_SHORT_PX);
    return KNEE_STEEP_DEG + (KNEE_FLAT_DEG - KNEE_STEEP_DEG) * Math.min(1, Math.max(0, t));
}

type Arc = {
    /** Point at arc length `s` from the foot, in the label's own pixel frame. */
    at: (s: number) => { x: number; y: number };
    radius: number;
    sweep: 0 | 1;
    /** Arc length spent bending, after which the branch runs straight. */
    bend: number;
    end: { x: number; y: number };
    /** How far the branch reaches away from the line. */
    reach: number;
};

/**
 * The curve a word is set along — see the note above on where it settles.
 *
 * Bending towards the horizontal buys back vertical room, which is the scarce
 * direction: the piece is thousands of pixels wide and only hundreds tall. So
 * every branch in the corpus can be shown at once without the tree growing
 * taller than the window it is read in.
 *
 * A word shorter than {@link BEND_LENGTH} stops partway round its own bend and
 * stands steeper than it would have settled — which is the same thing said
 * twice, and no accident.
 */
export function arcOf(length: number, side: -1 | 1): Arc {
    const t0 = side * ARC_START_DEG * DEG;
    const bend = Math.min(Math.max(0, length), BEND_LENGTH);
    const turn = side * (kneeAngle(length) - ARC_START_DEG) * DEG * (bend / BEND_LENGTH);

    if (length <= 0 || turn === 0) {
        const at = (s: number) => ({ x: s * Math.cos(t0), y: s * Math.sin(t0) });
        return { at, radius: 0, sweep: 1, bend: 0, end: at(length), reach: Math.abs(at(length).y) };
    }

    // Signed radius, and the same magnitude for every branch: the tangent turns
    // through the whole of `turn` over the whole of `bend`.
    const r = bend / turn;
    const t1 = t0 + turn;
    const onArc = (s: number) => {
        const t = t0 + turn * (s / bend);
        return { x: r * (Math.sin(t) - Math.sin(t0)), y: -r * (Math.cos(t) - Math.cos(t0)) };
    };
    const corner = onArc(bend);
    const at = (s: number) => {
        if (s <= bend) return onArc(s);
        const run = s - bend;
        return { x: corner.x + run * Math.cos(t1), y: corner.y + run * Math.sin(t1) };
    };

    // The tangent never crosses horizontal, so the far end is the furthest out.
    const end = at(length);
    return {
        at,
        radius: Math.abs(r),
        sweep: turn > 0 ? 1 : 0,
        bend,
        end,
        reach: Math.abs(end.y),
    };
}

/** The branch as an SVG path, starting at the label's foot: the bend, then the run. */
export function arcPathD(length: number, side: -1 | 1): string {
    const { radius, sweep, bend, at, end } = arcOf(length, side);
    if (radius === 0) return `M 0 0 L ${end.x} ${end.y}`;
    const corner = at(bend);
    const arc = `M 0 0 A ${radius} ${radius} 0 0 ${sweep} ${corner.x} ${corner.y}`;
    return length > bend ? `${arc} L ${end.x} ${end.y}` : arc;
}

export type LabelPlacement = {
    segment: Segment;
    /** Tick the label grows from. */
    tick: number;
    /** Which way the branch leans: -1 above the line, +1 below. */
    side: -1 | 1;
    /** Distance from the centre line to the label's foot, in pixels. */
    offset: number;
    depth: number;
    /** Pixel length of the text along its own curve. */
    length: number;
    fontSize: number;
};

const ROOT_OFFSET = 14;
const DEPTH_STEP = 16;
const TIER_STEP = 6;
const MAX_TIERS = 260;
/** How densely a branch is sampled when testing it against the ones already placed. */
const SAMPLE_STEP = 7;
const GRID_CELL = 36;

type Sample = { x: number; y: number; half: number };

/** Buckets of already-placed samples, so a branch is only tested near itself. */
function makeGrid() {
    // Numeric keys: a string key per lookup allocates through the hot loop, and
    // this is walked a few hundred thousand times to lay out a crowded tree.
    const cells = new Map<number, Sample[]>();
    const key = (cx: number, cy: number) => cx * 65536 + cy;
    return {
        clashes(samples: Sample[]): boolean {
            for (const s of samples) {
                const cx = Math.floor(s.x / GRID_CELL);
                const cy = Math.floor(s.y / GRID_CELL);
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const near = cells.get(key(cx + dx, cy + dy));
                        if (!near) continue;
                        for (const o of near) {
                            const clearance = s.half + o.half;
                            if (Math.hypot(s.x - o.x, s.y - o.y) < clearance) return true;
                        }
                    }
                }
            }
            return false;
        },
        add(samples: Sample[]) {
            for (const s of samples) {
                const k = key(Math.floor(s.x / GRID_CELL), Math.floor(s.y / GRID_CELL));
                const cell = cells.get(k);
                if (cell) cell.push(s);
                else cells.set(k, [s]);
            }
        },
    };
}

/**
 * Lay every segment's word out as a branch curving off the centre line.
 *
 * Nothing is culled, so all 128 words have to find room. The tilt is what makes
 * that affordable: two words on the same lean are near-parallel, so they clear
 * each other on a roughly fixed spacing between their feet **whatever their
 * length** — length stops costing horizontal room and starts costing only reach.
 *
 * Where feet are too close to clear, the later word is pushed a tier further
 * out, which is why a crowded stretch of the piece grows outwards rather than
 * overprinting itself. Longest first, so the gestures that carry the piece take
 * the branches nearest the line; roots lean up, everything nested leans down,
 * and depth starts a word further out still.
 *
 * Branches are curved, so the clean rotated-interval test no longer holds: each
 * one is sampled along its arc and checked against a grid of what is already
 * placed, which costs a few thousand point tests for the whole tree.
 */
export function packLabels(params: {
    segments: Segment[];
    depths: Map<string, number>;
    minPointSpan: number;
    stretchX: number;
    /** Pixel length of a segment's word, and the room it needs across the branch. */
    metricsOf: (segment: Segment) => { length: number; lineHeight: number };
}): LabelPlacement[] {
    const { segments, depths, minPointSpan, stretchX, metricsOf } = params;

    const candidates = segments
        .map(segment => {
            const { from, to } = tickRange(segment, minPointSpan);
            const { length, lineHeight } = metricsOf(segment);
            return {
                segment,
                tick: from,
                depth: depths.get(segment.id) ?? 0,
                span: to - from,
                length,
                lineHeight,
            };
        })
        // Longest first, so the gestures that carry the piece sit nearest the line.
        .sort((a, b) => b.span - a.span || a.tick - b.tick);

    // The two leans never meet, so they are packed against each other only.
    const grids = { [-1]: makeGrid(), [1]: makeGrid() };
    const out: LabelPlacement[] = [];

    for (const c of candidates) {
        const side: -1 | 1 = c.depth === 0 ? -1 : 1;
        const base = ROOT_OFFSET + (c.depth === 0 ? 0 : (c.depth - 1) * DEPTH_STEP);
        const px = c.tick * stretchX;
        const arc = arcOf(c.length, side);
        const half = c.lineHeight / 2;

        const steps = Math.max(2, Math.ceil(c.length / SAMPLE_STEP));
        let offset = base;
        for (let tier = 0; tier < MAX_TIERS; tier++) {
            offset = base + tier * TIER_STEP;
            const footY = side * offset;
            const samples: Sample[] = [];
            for (let i = 0; i <= steps; i++) {
                const p = arc.at((c.length * i) / steps);
                samples.push({ x: px + p.x, y: footY + p.y, half });
            }
            if (!grids[side].clashes(samples)) {
                grids[side].add(samples);
                break;
            }
        }

        out.push({
            segment: c.segment,
            tick: c.tick,
            side,
            offset,
            depth: c.depth,
            length: c.length,
            fontSize: c.lineHeight / LINE_HEIGHT_RATIO,
        });
    }

    return out;
}

/** Leading, as a multiple of the font size: the room a word needs across its branch. */
export const LINE_HEIGHT_RATIO = 1.35;

type TreeGeometry = {
    totalHeight: number;
    centreY: number;
};

const VERTICAL_PAD = 16;

/**
 * How much room the branches need above and below the line.
 *
 * A word reaches as far as its own arc carries it, so the tree is as tall as its
 * longest word is long — which is why the canvas grows rather than the words
 * being cut short.
 */
export function treeGeometry(params: {
    labels: LabelPlacement[];
    minHeight: number;
}): TreeGeometry {
    const { labels, minHeight } = params;

    let above = 0;
    let below = 0;
    for (const label of labels) {
        const reach = label.offset + arcOf(label.length, label.side).reach + label.fontSize;
        if (label.side === -1) above = Math.max(above, reach);
        else below = Math.max(below, reach);
    }

    const needed = above + below + VERTICAL_PAD * 2;
    if (needed < minHeight) {
        // Centre the tree in the space it does not fill.
        return { totalHeight: minHeight, centreY: minHeight * (above + VERTICAL_PAD) / needed };
    }
    return { totalHeight: needed, centreY: above + VERTICAL_PAD };
}

/* ── The inside of one segment, on its own axis: see `SegmentTimeline` ── */

/** Past this the grid stops reading as a grid, so the step doubles instead. */
const MAX_GRID_LINES = 12;

interface TimelineRow {
    /** What put these spans on one row: the type, unless the caller divides it finer. */
    lane: string;
    type: string;
    bars: { id: string; span: Span; left: number; width: number }[];
}

/**
 * A segment's gestures, one row per MPM element type, laid out over `width`.
 *
 * Types come in the order they first appear, so the same segment always reads in
 * the same sequence. Several gestures of one type share a row: they are one
 * voice arguing over the stretch, not several.
 *
 * `laneOf` divides a type where one row would draw two things at once — the
 * `movementMap` interleaves the sustain pedal with the soft one, and a curve
 * through both is a curve through neither. It only ever splits a type, never
 * merges two, so the ordering rule above still holds.
 *
 * Nothing is widened here. A gesture on a single date comes out `minBar` wide,
 * which the drawing rounds into a dot — on this axis the whole width is one
 * segment, so a dot is legible as itself.
 */
export function timelineRows(
    segment: Segment,
    from: number,
    to: number,
    width: number,
    minBar: number,
    laneOf: (span: Span) => string = span => span.type,
): TimelineRow[] {
    const ticks = to - from;
    const xOf = (tick: number) => Math.max(0, Math.min(1, (tick - from) / ticks)) * width;

    const byLane = new Map<string, Span[]>();
    for (const span of segment.spans) {
        const lane = laneOf(span);
        const row = byLane.get(lane);
        if (row) row.push(span);
        else byLane.set(lane, [span]);
    }

    return [...byLane].map(([lane, spans]) => ({
        lane,
        type: spans[0].type,
        bars: spans.map(span => {
            const left = xOf(span.from);
            const barWidth = Math.max(minBar, xOf(span.to) - left);
            // A gesture on the segment's last date would otherwise hang off the end.
            return {
                id: span.id,
                span,
                left: Math.max(0, Math.min(left, width - barWidth)),
                width: barWidth,
            };
        }),
    }));
}

/**
 * Where the beats fall inside a segment, in pixels from its start.
 *
 * This is what gives the rows a scale: without it a one-beat segment and a
 * ten-beat one are the same picture. They are the piece's beats rather than a
 * division of the segment, so a gesture that starts on a beat looks like one.
 */
export function beatGrid(from: number, to: number, beat: number, width: number): number[] {
    if (!(beat > 0) || !(to > from)) return [];
    let step = beat;
    while ((to - from) / step > MAX_GRID_LINES) step *= 2;

    const xs: number[] = [];
    for (let tick = Math.ceil(from / step) * step; tick < to; tick += step) {
        if (tick > from) xs.push(((tick - from) / (to - from)) * width);
    }
    return xs;
}
