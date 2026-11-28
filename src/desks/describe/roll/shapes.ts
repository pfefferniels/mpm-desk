import { clamp, type PlacedNote, type Rect } from './geometry';
import type { About, RollRemark } from './types';

/**
 * What a remark draws on the roll: a brace over a stretch, a hull round a set of notes, an arrow
 * from one note to another, and its words over each, kept off the words of the others.
 *
 * Everything here is pure and answers SVG path data or plain numbers; the component only puts
 * them in elements.
 */

export interface Point {
    x: number;
    y: number;
}

/** How tall a brace is, from its feet to its tip. */
export const BRACE = 9;
/** How far a hull stands off the notes it holds. */
export const HULL = 14;

/** Two decimals are below what a screen shows, and keep a path a tenth as long. */
const n = (value: number): string => String(Math.round(value * 100) / 100);

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

/** A brace over the stretch from `x0` to `x1`: its feet at `y`, its tip `BRACE` above the middle. */
export const bracePath = (x0: number, x1: number, y: number): string => {
    const mid = (x0 + x1) / 2;
    const q = Math.min(BRACE, (x1 - x0) / 4);
    const half = y - BRACE / 2;
    return [
        `M${n(x0)} ${n(y)}`,
        `Q${n(x0)} ${n(half)} ${n(x0 + q)} ${n(half)}`,
        `L${n(mid - q)} ${n(half)}`,
        `Q${n(mid)} ${n(half)} ${n(mid)} ${n(y - BRACE)}`,
        `Q${n(mid)} ${n(half)} ${n(mid + q)} ${n(half)}`,
        `L${n(x1 - q)} ${n(half)}`,
        `Q${n(x1)} ${n(half)} ${n(x1)} ${n(y)}`,
    ].join('');
};

/** How long the two strokes of an arrow's head are, and how far each turns off its shaft. */
const HEAD_LENGTH = 9;
const HEAD_TURN = 0.45;

/** A bowed arrow from `from` to `to`, whose middle passes through y = `apex`, with its head. */
export const arrowPath = (from: Point, to: Point, apex: number): string => {
    const control = { x: (from.x + to.x) / 2, y: 2 * apex - (from.y + to.y) / 2 };
    const angle = Math.atan2(to.y - control.y, to.x - control.x);
    const head = [-HEAD_TURN, HEAD_TURN].map(
        (turn) =>
            `M${n(to.x)} ${n(to.y)}L${n(to.x - HEAD_LENGTH * Math.cos(angle + turn))} ${n(to.y - HEAD_LENGTH * Math.sin(angle + turn))}`,
    );
    return `M${n(from.x)} ${n(from.y)}Q${n(control.x)} ${n(control.y)} ${n(to.x)} ${n(to.y)}${head.join('')}`;
};

/**
 * Outline around note rectangles: smoothed upper and lower envelopes, sampled every `STEP` px
 * between `from` and `to`. Returns its points in order around it: along the top from the left,
 * and back along the bottom.
 *
 * It stands `HULL` off the notes where it runs straight, never nearer than `NEAR` to any of them,
 * and reaches `HULL` past the first and the last.
 */
export const hullOf = (rects: readonly Rect[], from = -Infinity, to = Infinity): Point[] => {
    if (rects.length === 0) return [];
    const STEP = 4;
    const NEAR = 8; // minimum distance to a note, px
    const WIDE = 10; // steps: concavities narrower than twice this are filled
    const ROUND = 6; // steps: smoothing radius
    const left = Math.max(from, Math.min(...rects.map((r) => r.x)) - HULL);
    const right = Math.min(to, Math.max(...rects.map((r) => r.x + r.w)) + HULL);
    const count = Math.max(2, Math.ceil((right - left) / STEP) + 1);
    const column = () => new Array<number | null>(count).fill(null);
    const [top, bottom, topMost, bottomMost] = [column(), column(), column(), column()];
    for (const r of rects) {
        const a = Math.max(0, Math.floor((r.x - HULL - left) / STEP));
        const b = Math.min(count - 1, Math.ceil((r.x + r.w + HULL - left) / STEP));
        for (let i = a; i <= b; i++) {
            top[i] = Math.min(top[i] ?? Infinity, r.y - HULL);
            bottom[i] = Math.max(bottom[i] ?? -Infinity, r.y + r.h + HULL);
            const x = left + i * STEP;
            if (x < r.x - NEAR || x > r.x + r.w + NEAR) continue;
            topMost[i] = Math.min(topMost[i] ?? Infinity, r.y - NEAR);
            bottomMost[i] = Math.max(bottomMost[i] ?? -Infinity, r.y + r.h + NEAR);
        }
    }
    // Interpolate across columns without a note.
    const bridge = (values: readonly (number | null)[]): number[] => {
        const bridged = new Array<number>(count).fill(0);
        let before = -1;
        for (let i = 0; i < count; i++) {
            const value = values[i];
            if (value === null) continue;
            bridged[i] = value;
            for (let j = before + 1; j < i; j++) {
                bridged[j] = before < 0 ? value : bridged[before] + ((value - bridged[before]) * (j - before)) / (i - before);
            }
            before = i;
        }
        for (let j = before + 1; j < count; j++) bridged[j] = before < 0 ? 0 : bridged[before];
        return bridged;
    };
    const sliding = (values: readonly number[], radius: number, pick: (...window: number[]) => number) =>
        values.map((_, i) => pick(...values.slice(Math.max(0, i - radius), i + radius + 1)));
    const mean = (...values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    // Fill concavities, smooth, and re-apply the minimum distance to the notes (`keep`).
    const eased = (
        values: readonly number[],
        out: (...window: number[]) => number,
        back: (...window: number[]) => number,
        keep: (y: number, i: number) => number,
    ) => {
        let line = sliding(sliding(values, WIDE, out), WIDE, back);
        line = sliding(sliding(line, ROUND, mean), ROUND, mean).map(keep);
        return sliding(line, 2, mean).map(keep);
    };
    const offTop = (y: number, i: number) => Math.min(y, topMost[i] ?? Infinity);
    const offBottom = (y: number, i: number) => Math.max(y, bottomMost[i] ?? -Infinity);
    const over = eased(bridge(top), Math.min, Math.max, offTop);
    const under = eased(bridge(bottom), Math.max, Math.min, offBottom);
    // Round both ends, radius at most `END` px.
    const END = 26;
    const close = (i: number, d: number) => {
        const radius = Math.min((under[i] - over[i]) / 2, END);
        if (d >= radius) return;
        const inset = radius - Math.sqrt(radius * radius - (radius - d) ** 2);
        over[i] = offTop(over[i] + inset, i);
        under[i] = offBottom(under[i] - inset, i);
    };
    for (let k = 0; k * STEP < END && k < count / 2 - 1; k++) {
        close(k, k * STEP);
        close(count - 1 - k, k * STEP);
    }
    const points = over.map((y, i) => ({ x: left + i * STEP, y }));
    for (let i = count - 1; i >= 0; i--) points.push({ x: left + i * STEP, y: under[i] });
    return points;
};

/** A closed smooth path through the midpoints between consecutive points. */
export const softLine = (points: readonly Point[]): string => {
    const count = points.length;
    if (count < 3) return '';
    const between = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const start = between(points[count - 1], points[0]);
    const curves = points.map((point, i) => {
        const to = between(point, points[(i + 1) % count]);
        return `Q${n(point.x)} ${n(point.y)} ${n(to.x)} ${n(to.y)}`;
    });
    return `M${n(start.x)} ${n(start.y)}${curves.join('')}Z`;
};

/** The rounded hull round a set of note rectangles, as one closed path. */
export const hullPath = (rects: readonly Rect[], from = -Infinity, to = Infinity): string => softLine(hullOf(rects, from, to));

// ---------------------------------------------------------------------------------------------
// The mark a remark makes
// ---------------------------------------------------------------------------------------------

interface Extent {
    /** From where to where it reaches along the roll. */
    xa: number;
    xb: number;
    /** Where it would sit, or its words would, with nothing else in the way. */
    y: number;
}

export type Mark =
    | ({ kind: 'brace' } & Extent)
    | ({ kind: 'hull'; rects: Rect[] } & Extent)
    | ({ kind: 'arrow'; from: Point; to: Point; apex: number } & Extent);

interface MarkOptions {
    notes: readonly PlacedNote[];
    byId: ReadonlyMap<string, PlacedNote>;
    /** Where a score date is drawn. */
    xAt: (date: number) => number;
    /** Whether the shadows are drawn, and so have to be cleared too. */
    shadows: boolean;
}

/** A brace over the stretch, standing clear of every note in it. */
const stretchOver = (about: About, { notes, xAt, shadows }: MarkOptions): Mark | null => {
    const held = notes.filter(({ note }) => note.date >= about.from && note.date < about.to);
    if (held.length === 0) return null;
    const xa = xAt(about.from);
    const xb = Math.max(xAt(about.to), xa + 14);
    let top = Infinity;
    for (const { now, was } of held) top = Math.min(top, now.y, shadows ? was.y : Infinity);
    return { kind: 'brace', xa, xb, y: top - 5 };
};

/** A hull round the notes named. */
const setRound = (about: About, { byId }: MarkOptions): Mark | null => {
    const rects = about.notes.flatMap((id) => byId.get(id)?.now ?? []);
    if (rects.length === 0) return null;
    return {
        kind: 'hull',
        rects,
        xa: Math.min(...rects.map((r) => r.x)) - HULL,
        xb: Math.max(...rects.map((r) => r.x + r.w)) + HULL,
        y: Math.min(...rects.map((r) => r.y)) - HULL - 1,
    };
};

/** An arrow from the first note named to the second, bowed over whatever its hand plays between them. */
const arrowBetween = (about: About, { notes, byId }: MarkOptions): Mark | null => {
    const [first, last] = about.notes.map((id) => byId.get(id));
    if (!first || !last) return null;
    const [a, b] = [first.now, last.now];
    const from = { x: a.x + Math.min(a.w / 2, 5), y: a.y - 3 };
    const to = { x: Math.max(b.x + Math.min(b.w / 2, 3), from.x + 14), y: b.y - 4 };
    const between = notes
        .filter(({ note }) => note.part === first.note.part && note.date > first.note.date && note.date < last.note.date)
        .map(({ now }) => now.y);
    const apex = Math.min(from.y, to.y, ...between) - clamp((to.x - from.x) * 0.08, 8, 22);
    return { kind: 'arrow', from, to, apex, xa: from.x, xb: to.x, y: apex - 2 };
};

/** The mark of what a remark is about, or none where it is about the whole piece or about nothing on the roll. */
export const markOf = (about: About, options: MarkOptions): Mark | null =>
    about.kind === 'piece'
        ? null
        : about.kind === 'span'
          ? stretchOver(about, options)
          : about.kind === 'arrow'
            ? arrowBetween(about, options)
            : setRound(about, options);

// ---------------------------------------------------------------------------------------------
// Words, and keeping them off one another
// ---------------------------------------------------------------------------------------------

/** How tall a row of words is, in the roll and over it. */
export const LANE = 22;
/** What a badge after the words takes. */
export const BADGE = 20;

/** A remark as it is written on the roll: on one line, and not all of a long one. */
export const shown = (text: string): string => (text.length > 64 ? `${text.slice(0, 62)}…` : text.replace(/\s+/g, ' '));

/** The badge after a remark's words: where the expert asks back, and where something went wrong. */
export const badgeOf = (remark: Pick<RollRemark, 'state'>): '?' | '!' | null =>
    remark.state === 'question' ? '?' : remark.state === 'trouble' ? '!' : null;

/** How wide a remark is written, badge included. */
export const widthOfWords = (measure: (text: string) => number, remark: Pick<RollRemark, 'text' | 'state'>): number =>
    measure(shown(remark.text)) + (badgeOf(remark) ? BADGE : 0);

/** The top of a row of what is written over the roll. */
export const rowY = (row: number): number => 3 + row * LANE;

/** What has been put over the notes so far: a mark with its words. */
interface Taken {
    xa: number;
    xb: number;
    top: number;
    bottom: number;
}

/** Where a mark came to sit. */
export interface Spot {
    xa: number;
    xb: number;
    /** Its lower edge: a brace's feet. */
    y: number;
    /** The y its words sit above: a brace's tip. */
    point: number;
    /** The left end and the middle of its words, if it has any. */
    words: Point | null;
}

interface Bounds {
    /** Where the roll begins under the ruler. */
    top: number;
    /** The roll's left and right edge, which words are kept inside. */
    left: number;
    right: number;
}

/** Moves `y` up until `room` px above it are clear of what has been placed so far. */
const clearOf = (taken: readonly Taken[], xa: number, xb: number, y: number, room: number, top: number): number => {
    for (let again = true, turns = 0; again && turns < 12; turns++) {
        again = false;
        for (const other of taken) {
            if (other.xa < xb + 8 && other.xb > xa - 8 && y - room < other.bottom && y > other.top) {
                y = other.top - 4;
                again = true;
            }
        }
    }
    return Math.max(y, top + room - 10);
};

/**
 * Seats each mark, with its words over it, clear of those before it: a later one that would run
 * into an earlier one's words goes above them. So the order is the order of precedence, and the
 * caller puts the shortest stretches first, whose marks belong nearest the notes.
 *
 * @param marks `width` is how wide its words are; a mark without words is seated and takes no room
 */
export const placeOver = (marks: readonly { mark: Mark; width: number | null }[], { top, left, right }: Bounds): Spot[] => {
    const taken: Taken[] = [];
    return marks.map(({ mark, width }) => {
        const rise = mark.kind === 'brace' ? BRACE : 0;
        const y = clearOf(taken, mark.xa, mark.xb, mark.y, rise + 24, top);
        const point = y - rise;
        if (width === null) return { xa: mark.xa, xb: mark.xb, y, point, words: null };
        const x = clamp((mark.xa + mark.xb) / 2 - width / 2, left + 6, right - width - 8);
        taken.push({ xa: Math.min(mark.xa, x - 4), xb: Math.max(mark.xb, x + width + 4), top: point - LANE, bottom: y });
        return { xa: mark.xa, xb: mark.xb, y, point, words: { x, y: point - LANE / 2 } };
    });
};

/** The path of a mark where it came to sit. */
export const markPath = (mark: Mark, spot: Pick<Spot, 'y'>): string =>
    mark.kind === 'brace'
        ? bracePath(mark.xa, mark.xb, spot.y)
        : mark.kind === 'arrow'
          ? arrowPath(mark.from, mark.to, mark.apex)
          : hullPath(mark.rects);

/**
 * Lays the remarks about the whole piece out in rows along the top, in the order they were made.
 *
 * @param widths of each remark's words, badge included
 * @returns where each begins and in which row, and how many rows that takes
 */
export const lanesOf = (widths: readonly number[], left: number, right: number): { places: { x: number; row: number }[]; rows: number } => {
    let x = left;
    let row = 0;
    const places = widths.map((width) => {
        if (x + width > right && x > left) {
            row++;
            x = left;
        }
        const place = { x, row };
        x += width + 26;
        return place;
    });
    return { places, rows: places.length ? row + 1 : 0 };
};

/**
 * Measures words as the browser will set them, for placing them before they are drawn.
 *
 * Where nothing can measure, in a test or on a server, a width is estimated from the number of
 * letters: near enough to keep words apart, which is all it is used for.
 *
 * @param font as CSS states one, size first: `16px "EB Garamond", serif`
 */
export const measurer = (font: string): ((text: string) => number) => {
    const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 16);
    const estimate = (text: string) => text.length * size * 0.45;
    if (typeof OffscreenCanvas === 'undefined') return estimate;
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (!context) return estimate;
    return (text) => {
        context.font = font;
        return context.measureText(text).width;
    };
};

// ---------------------------------------------------------------------------------------------
// All of it together
// ---------------------------------------------------------------------------------------------

/** Something written about a part of the roll: a remark, or the selection being described. */
interface Written<T> {
    item: T;
    about: About;
    /** How wide its words are, or `null` for a mark without words. */
    width: number | null;
}

export interface Seated<T> {
    item: T;
    mark: Mark;
    spot: Spot;
    /** The mark where it came to sit, as path data. */
    path: string;
}

/**
 * Every mark in the roll with its place.
 *
 * The shortest stretches are seated first, so their marks go nearest the notes; whatever has no
 * words, the selection being described, goes last and takes the place the others leave.
 */
export const seatAll = <T>(written: readonly Written<T>[], options: MarkOptions, bounds: Bounds): Seated<T>[] => {
    const marked = written
        .flatMap(({ item, about, width }) => {
            const mark = markOf(about, options);
            return mark ? [{ item, mark, width, length: about.to - about.from }] : [];
        })
        .sort((a, b) => Number(a.width === null) - Number(b.width === null) || a.length - b.length);
    const spots = placeOver(marked, bounds);
    return marked.map(({ item, mark }, i) => ({ item, mark, spot: spots[i], path: markPath(mark, spots[i]) }));
};
