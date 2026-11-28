import { describe, expect, it } from 'vitest';
import type { NoteRect, PlacedNote, Rect } from './geometry';
import {
    arrowPath,
    BRACE,
    bracePath,
    HULL,
    hullOf,
    hullPath,
    LANE,
    lanesOf,
    markOf,
    markPath,
    measurer,
    placeOver,
    seatAll,
    shown,
    softLine,
    type Mark,
    type Point,
} from './shapes';
import type { About, RollNote } from './types';

/** Every pair of numbers in a path, in order: its end points and its control points. */
const pointsOf = (path: string): Point[] => {
    const numbers = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const points: Point[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
    return points;
};

/** The hull as two lines: how high it stands and how low it hangs at each sampled x. */
const envelopes = (points: readonly Point[]) => {
    const half = points.length / 2;
    const top = points.slice(0, half);
    const bottom = points.slice(half).reverse();
    return top.map((point, i) => ({ x: point.x, top: point.y, bottom: bottom[i].y }));
};

describe('bracePath', () => {
    it('stands with its feet at both ends of the stretch', () => {
        const points = pointsOf(bracePath(100, 300, 50));
        expect(points[0]).toEqual({ x: 100, y: 50 });
        expect(points.at(-1)).toEqual({ x: 300, y: 50 });
    });

    it('has its tip over the middle, as far up as a brace is tall', () => {
        const points = pointsOf(bracePath(100, 300, 50));
        expect(points).toContainEqual({ x: 200, y: 50 - BRACE });
        // Nothing of it is higher than the tip or lower than the feet.
        expect(Math.min(...points.map((point) => point.y))).toBe(50 - BRACE);
        expect(Math.max(...points.map((point) => point.y))).toBe(50);
    });

    it('runs level half-way up, between shoulders as wide as it is tall', () => {
        const path = bracePath(100, 300, 50);
        expect(path).toContain(`L${String(200 - BRACE)} ${String(50 - BRACE / 2)}`);
        expect(path).toContain(`L${String(300 - BRACE)} ${String(50 - BRACE / 2)}`);
    });

    it('draws its shoulders in over a stretch too short for them', () => {
        const points = pointsOf(bracePath(0, 16, 50));
        // A quarter of the width each, so that the four curves still meet.
        expect(points).toContainEqual({ x: 4, y: 50 - BRACE / 2 });
        expect(points).toContainEqual({ x: 12, y: 50 - BRACE / 2 });
        expect(points.every((point) => point.x >= 0 && point.x <= 16)).toBe(true);
    });

    it('is one stroke', () => {
        expect(bracePath(100, 300, 50).match(/M/g)).toHaveLength(1);
    });
});

describe('arrowPath', () => {
    const from = { x: 100, y: 200 };
    const to = { x: 300, y: 160 };
    const path = arrowPath(from, to, 120);
    const [start, control, end, ...head] = pointsOf(path);

    it('goes from the one note to the other', () => {
        expect(start).toEqual(from);
        expect(end).toEqual(to);
    });

    it('bows through the apex half-way', () => {
        // A quadratic curve at its middle: a quarter of each end and half of the control point.
        expect(0.25 * start.x + 0.5 * control.x + 0.25 * end.x).toBe(200);
        expect(0.25 * start.y + 0.5 * control.y + 0.25 * end.y).toBe(120);
    });

    it('ends in a head of two strokes, each back from the tip along the way it came', () => {
        expect(head).toHaveLength(4);
        const [tipA, barbA, tipB, barbB] = head;
        expect(tipA).toEqual(to);
        expect(tipB).toEqual(to);
        for (const barb of [barbA, barbB]) {
            expect(Math.hypot(barb.x - to.x, barb.y - to.y)).toBeCloseTo(9, 1);
            // Behind the tip, on the side the curve arrives from.
            expect((barb.x - to.x) * (to.x - control.x) + (barb.y - to.y) * (to.y - control.y)).toBeLessThan(0);
        }
        expect(barbA).not.toEqual(barbB);
    });

    it('points the other way when it is drawn the other way', () => {
        const back = pointsOf(arrowPath(to, from, 120));
        expect(back[0]).toEqual(to);
        expect(back[2]).toEqual(from);
        expect(back[4].x).toBeGreaterThan(from.x);
    });
});

describe('hullOf', () => {
    const NEAR = 8;

    /** Whether the hull keeps `least` px above and below `rect` at every sample over it. */
    const clears = (points: readonly Point[], rect: Rect, least: number) =>
        envelopes(points)
            .filter(({ x }) => x >= rect.x && x <= rect.x + rect.w)
            .every(({ top, bottom }) => top <= rect.y - least + 1e-9 && bottom >= rect.y + rect.h + least - 1e-9);

    it('stands the padding off a note, above and below and at both ends', () => {
        const rect = { x: 200, y: 100, w: 300, h: 10 };
        const lines = envelopes(hullOf([rect]));
        expect(lines[0].x).toBe(rect.x - HULL);
        expect(lines.at(-1)!.x).toBeGreaterThanOrEqual(rect.x + rect.w + HULL);
        expect(lines.at(-1)!.x).toBeLessThan(rect.x + rect.w + HULL + 4);
        // Along the middle of a long note it runs straight, the padding away.
        for (const { top, bottom } of lines.filter(({ x }) => x > 300 && x < 400)) {
            expect(top).toBeCloseTo(rect.y - HULL, 6);
            expect(bottom).toBeCloseTo(rect.y + rect.h + HULL, 6);
        }
    });

    it('never comes nearer a note than eight pixels, and never stands further off than the padding', () => {
        const rects = [
            { x: 100, y: 200, w: 60, h: 10 },
            { x: 170, y: 150, w: 40, h: 12 },
            { x: 230, y: 240, w: 90, h: 8 },
            { x: 400, y: 100, w: 20, h: 30 },
        ];
        const points = hullOf(rects);
        for (const rect of rects) expect(clears(points, rect, NEAR)).toBe(true);
        const lines = envelopes(points);
        expect(Math.min(...lines.map((line) => line.top))).toBeGreaterThanOrEqual(100 - HULL - 1e-9);
        expect(Math.max(...lines.map((line) => line.bottom))).toBeLessThanOrEqual(248 + HULL + 1e-9);
    });

    it('encloses every one of its rectangles', () => {
        const rects = Array.from({ length: 24 }, (_, i) => ({ x: 50 + i * 37, y: 300 + 80 * Math.sin(i * 1.3), w: 20 + (i % 5) * 9, h: 6 + (i % 4) * 3 }));
        const lines = envelopes(hullOf(rects));
        for (const rect of rects) {
            const over = lines.filter(({ x }) => x >= rect.x - NEAR && x <= rect.x + rect.w + NEAR);
            expect(over.length).toBeGreaterThan(0);
            for (const { top, bottom } of over) {
                expect(top).toBeLessThanOrEqual(rect.y - NEAR + 1e-9);
                expect(bottom).toBeGreaterThanOrEqual(rect.y + rect.h + NEAR - 1e-9);
            }
        }
        expect(lines[0].x).toBe(Math.min(...rects.map((rect) => rect.x)) - HULL);
        expect(lines.at(-1)!.x).toBeGreaterThanOrEqual(Math.max(...rects.map((rect) => rect.x + rect.w)) + HULL);
    });

    it('holds two notes far apart in one outline, drawn in between them', () => {
        const [a, b] = [
            { x: 100, y: 100, w: 30, h: 10 },
            { x: 600, y: 300, w: 30, h: 10 },
        ];
        const lines = envelopes(hullOf([a, b]));
        // One sample every four pixels, with none missing between the notes.
        for (let i = 1; i < lines.length; i++) expect(lines[i].x - lines[i - 1].x).toBe(4);
        const middle = lines.find(({ x }) => x >= 365)!;
        expect(middle.top).toBeGreaterThan(a.y - HULL);
        expect(middle.bottom).toBeLessThan(b.y + b.h + HULL);
        expect(middle.bottom).toBeGreaterThan(middle.top);
    });

    it('fills a narrow gap between two notes at a height, and follows a wide one down', () => {
        const high = (x: number) => ({ x, y: 100, w: 40, h: 10 });
        const narrow = envelopes(hullOf([high(100), { x: 150, y: 200, w: 20, h: 10 }, high(180)]));
        const wide = envelopes(hullOf([high(100), { x: 150, y: 200, w: 300, h: 10 }, high(460)]));
        // Over the low note between two high ones close by, the top stays up.
        expect(narrow.find(({ x }) => x >= 160)!.top).toBeCloseTo(100 - HULL, 6);
        // Over a long low note it comes down to it.
        expect(wide.find(({ x }) => x >= 300)!.top).toBeCloseTo(200 - HULL, 6);
    });

    it('rounds its ends', () => {
        const lines = envelopes(hullOf([{ x: 200, y: 100, w: 300, h: 40 }]));
        const [first, inner] = [lines[0], lines[10]];
        expect(first.bottom - first.top).toBeLessThan(inner.bottom - inner.top);
        expect(lines.at(-1)!.bottom - lines.at(-1)!.top).toBeLessThan(inner.bottom - inner.top);
    });

    it('keeps to the stretch it is given', () => {
        const lines = envelopes(hullOf([{ x: 0, y: 100, w: 1000, h: 10 }], 300, 500));
        expect(lines[0].x).toBe(300);
        expect(lines.at(-1)!.x).toBeLessThan(504);
    });

    it('goes round: along the top from the left, and back along the bottom', () => {
        const points = hullOf([{ x: 200, y: 100, w: 100, h: 10 }]);
        const half = points.length / 2;
        const [top, bottom] = [points.slice(0, half), points.slice(half)];
        const across = top.map((point) => point.x);
        expect(across).toEqual([...across].sort((a, b) => a - b));
        expect(bottom.map((point) => point.x)).toEqual([...across].reverse());
        // Half-way along, the first line is the upper one.
        const middle = Math.floor(half / 2);
        expect(bottom[half - 1 - middle].y).toBeGreaterThan(top[middle].y);
    });

    it('is nothing for no notes', () => {
        expect(hullOf([])).toEqual([]);
        expect(hullPath([])).toBe('');
    });
});

describe('softLine', () => {
    const square = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ];

    it('closes on itself', () => {
        const path = softLine(square);
        expect(path.startsWith('M')).toBe(true);
        expect(path.endsWith('Z')).toBe(true);
        const points = pointsOf(path);
        expect(points.at(-1)).toEqual(points[0]);
    });

    it('passes through the middle of every side, with the corners as what it bends towards', () => {
        const points = pointsOf(softLine(square));
        expect(points[0]).toEqual({ x: 0, y: 5 });
        // Then, for every corner: the corner, and the middle of the side after it.
        expect(points.slice(1)).toEqual([
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 10, y: 10 },
            { x: 5, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 5 },
        ]);
    });

    it('stays inside the points it is drawn from', () => {
        const rect = { x: 200, y: 100, w: 120, h: 10 };
        const corners = pointsOf(hullPath([rect]));
        expect(Math.min(...corners.map((point) => point.x))).toBeGreaterThanOrEqual(rect.x - HULL);
        expect(Math.min(...corners.map((point) => point.y))).toBeGreaterThanOrEqual(rect.y - HULL);
        expect(Math.max(...corners.map((point) => point.y))).toBeLessThanOrEqual(rect.y + rect.h + HULL);
    });

    it('draws nothing through fewer than three points', () => {
        expect(softLine(square.slice(0, 2))).toBe('');
    });
});

// ---------------------------------------------------------------------------------------------

const box = (x: number, y: number, w = 20, h = 10): NoteRect => ({ x, y, w, h, ink: 0.7 });

/** A note with its box, played where it is rendered unless `was` says otherwise. */
const placed = (id: string, date: number, now: NoteRect, over: { part?: number; was?: NoteRect } = {}): PlacedNote => ({
    note: {
        id,
        part: over.part ?? 1,
        staff: 'treble',
        pitch: 60,
        letter: 'c',
        alter: 0,
        date,
        duration: 720,
        played: { ms: 0, msEnd: 1, velocity: 64 },
        rendered: { ms: 0, msEnd: 1, velocity: 64 },
    } satisfies RollNote,
    y: now.y + now.h / 2,
    now,
    was: over.was ?? now,
    shadowed: over.was !== undefined,
    arrived: null,
    ledgers: [],
    accidental: null,
});

/** Four notes a beat apart, rising, then one in the other hand under the third. */
const notes = [
    placed('a', 0, box(0, 300)),
    placed('b', 720, box(100, 280)),
    placed('c', 1440, box(200, 200)),
    placed('d', 2160, box(300, 260)),
    placed('low', 1440, box(200, 400), { part: 2 }),
];
const options = (shadows = false, over: readonly PlacedNote[] = notes) => ({
    notes: over,
    byId: new Map(over.map((entry) => [entry.note.id, entry])),
    xAt: (date: number) => (date / 720) * 100,
    shadows,
});
const about = (kind: About['kind'], from: number, to: number, ids: string[] = []): About => ({ kind, from, to, notes: ids });
const bounds = { top: 24, left: 0, right: 2000 };

describe('markOf', () => {
    it('braces a stretch from where it begins to where it ends, over the highest note in it', () => {
        const mark = markOf(about('span', 720, 2160), options());
        expect(mark).toEqual({ kind: 'brace', xa: 100, xb: 300, y: 200 - 5 });
    });

    it('clears the shadows too, where they are drawn', () => {
        const shadowed = [...notes.slice(0, 2), placed('c', 1440, box(200, 200), { was: box(190, 180, 20, 30) }), ...notes.slice(3)];
        expect(markOf(about('span', 720, 2160), options(false, shadowed))?.y).toBe(195);
        expect(markOf(about('span', 720, 2160), options(true, shadowed))?.y).toBe(175);
    });

    it('gives the shortest stretch a brace wide enough to be one', () => {
        const mark = markOf(about('span', 0, 72), options());
        expect(mark).toMatchObject({ kind: 'brace', xa: 0, xb: 14 });
    });

    it('draws nothing for a stretch without notes, nor for the whole piece', () => {
        expect(markOf(about('span', 5000, 6000), options())).toBeNull();
        expect(markOf(about('piece', 0, 9999), options())).toBeNull();
    });

    it('draws a hull round the notes a set or a box names', () => {
        for (const kind of ['notes', 'box'] as const) {
            const mark = markOf(about(kind, 0, 1440, ['a', 'b']), options());
            expect(mark).toMatchObject({ kind: 'hull', xa: 0 - HULL, xb: 120 + HULL, y: 280 - HULL - 1 });
            expect(mark?.kind === 'hull' && mark.rects).toEqual([box(0, 300), box(100, 280)]);
        }
    });

    it('leaves out a note it is told of but does not have', () => {
        const mark = markOf(about('notes', 0, 720, ['a', 'gone']), options());
        expect(mark?.kind === 'hull' && mark.rects).toEqual([box(0, 300)]);
        expect(markOf(about('notes', 0, 720, ['gone']), options())).toBeNull();
    });

    it('draws an arrow from the first note named to the second, from just over the one to just over the other', () => {
        const mark = markOf(about('arrow', 0, 2880, ['a', 'd']), options());
        expect(mark).toMatchObject({ kind: 'arrow', from: { x: 5, y: 297 }, to: { x: 303, y: 256 } });
    });

    it('bows the arrow over whatever its hand plays in between, and not over the other hand', () => {
        const mark = markOf(about('arrow', 0, 2880, ['a', 'd']), options());
        // The third note is the highest between them; the note under it is the left hand's.
        expect(mark?.kind === 'arrow' && mark.apex).toBe(200 - 22);
        const over = markOf(about('arrow', 0, 1440, ['a', 'b']), options());
        expect(over?.kind === 'arrow' && over.apex).toBeCloseTo(276 - 8, 6);
    });

    it('draws no arrow to a note it does not have', () => {
        expect(markOf(about('arrow', 0, 720, ['a', 'gone']), options())).toBeNull();
    });
});

describe('placeOver', () => {
    const brace = (xa: number, xb: number, y: number): Mark => ({ kind: 'brace', xa, xb, y });

    it('seats a brace where it wants to be, with its words centred over its tip', () => {
        const [spot] = placeOver([{ mark: brace(100, 300, 200), width: 80 }], bounds);
        expect(spot).toMatchObject({ xa: 100, xb: 300, y: 200, point: 200 - BRACE });
        expect(spot.words).toEqual({ x: 160, y: 200 - BRACE - LANE / 2 });
    });

    it('puts a later mark that would run into an earlier one over its words', () => {
        const [inner, outer] = placeOver(
            [
                { mark: brace(100, 300, 200), width: 80 },
                { mark: brace(50, 400, 200), width: 80 },
            ],
            bounds,
        );
        expect(inner.y).toBe(200);
        // Above the top of the first one's words, with a little air.
        expect(outer.y).toBe(inner.point - LANE - 4);
        expect(outer.words!.y).toBeLessThan(inner.words!.y - LANE);
    });

    it('leaves marks alone that are nowhere near one another', () => {
        const spots = placeOver(
            [
                { mark: brace(100, 300, 200), width: 80 },
                { mark: brace(600, 800, 200), width: 80 },
                { mark: brace(100, 300, 400), width: 80 },
            ],
            bounds,
        );
        expect(spots.map((spot) => spot.y)).toEqual([200, 200, 400]);
    });

    it('keeps the words of all of them off one another', () => {
        const marks = Array.from({ length: 8 }, (_, i) => ({ mark: brace(100 + i * 15, 320 + i * 10, 300), width: 120 }));
        const spots = placeOver(marks, bounds);
        const words = spots.map((spot) => ({ x0: spot.words!.x, x1: spot.words!.x + 120, y0: spot.words!.y - LANE / 2, y1: spot.words!.y + LANE / 2 }));
        for (const [i, a] of words.entries()) {
            for (const b of words.slice(i + 1)) {
                const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
                expect(overlap).toBe(false);
            }
        }
    });

    it('takes account of words wider than their mark', () => {
        const [, beside] = placeOver(
            [
                { mark: brace(200, 220, 200), width: 200 },
                { mark: brace(270, 290, 195), width: 20 },
            ],
            bounds,
        );
        // The second brace is clear of the first, but not of its words.
        expect(beside.y).toBeLessThan(195);
    });

    it('seats a mark without words clear of the others, and lets it take no room itself', () => {
        const [, wordless, after] = placeOver(
            [
                { mark: brace(100, 300, 200), width: 80 },
                { mark: brace(100, 300, 200), width: null },
                { mark: brace(100, 300, 200), width: 80 },
            ],
            bounds,
        );
        expect(wordless.words).toBeNull();
        expect(wordless.y).toBe(200 - BRACE - LANE - 4);
        expect(after.y).toBe(wordless.y);
    });

    it('writes the words of a hull and of an arrow right over them', () => {
        const hull: Mark = { kind: 'hull', rects: [], xa: 100, xb: 200, y: 150 };
        const arrow: Mark = { kind: 'arrow', from: { x: 400, y: 200 }, to: { x: 500, y: 180 }, apex: 160, xa: 400, xb: 500, y: 158 };
        const [over, along] = placeOver(
            [
                { mark: hull, width: 60 },
                { mark: arrow, width: 60 },
            ],
            bounds,
        );
        expect(over).toMatchObject({ y: 150, point: 150, words: { x: 120, y: 150 - LANE / 2 } });
        expect(along).toMatchObject({ y: 158, point: 158, words: { x: 420, y: 158 - LANE / 2 } });
    });

    it('keeps words inside the roll at either end', () => {
        const [first, last] = placeOver(
            [
                { mark: brace(0, 20, 200), width: 100 },
                { mark: brace(1980, 2000, 200), width: 100 },
            ],
            bounds,
        );
        expect(first.words!.x).toBe(6);
        expect(last.words!.x).toBe(2000 - 100 - 8);
    });

    it('does not send a mark up out of the roll', () => {
        const [spot] = placeOver([{ mark: brace(100, 300, 0), width: 80 }], bounds);
        expect(spot.y).toBe(bounds.top + BRACE + 24 - 10);
        const stacked = placeOver(
            Array.from({ length: 30 }, () => ({ mark: brace(100, 300, 100), width: 80 })),
            bounds,
        );
        expect(Math.min(...stacked.map((each) => each.y))).toBeGreaterThanOrEqual(bounds.top + BRACE + 24 - 10);
    });
});

describe('markPath', () => {
    it('draws a brace where it came to sit, not where it wanted to be', () => {
        const mark: Mark = { kind: 'brace', xa: 100, xb: 300, y: 200 };
        expect(markPath(mark, { y: 150 })).toBe(bracePath(100, 300, 150));
    });

    it('leaves a hull and an arrow on their notes, wherever their words went', () => {
        const rects = [{ x: 100, y: 100, w: 50, h: 10 }];
        expect(markPath({ kind: 'hull', rects, xa: 86, xb: 164, y: 85 }, { y: 20 })).toBe(hullPath(rects));
        const arrow: Mark = { kind: 'arrow', from: { x: 0, y: 50 }, to: { x: 80, y: 40 }, apex: 30, xa: 0, xb: 80, y: 28 };
        expect(markPath(arrow, { y: 5 })).toBe(arrowPath(arrow.from, arrow.to, 30));
    });
});

describe('seatAll', () => {
    const written = [
        { item: 'long', about: about('span', 0, 2880), width: 80 },
        { item: 'draft', about: about('span', 720, 2160), width: null },
        { item: 'nowhere', about: about('span', 9000, 9999), width: 80 },
        { item: 'short', about: about('span', 720, 1440), width: 80 },
        { item: 'whole', about: about('piece', 0, 2880), width: 80 },
    ];

    it('seats the shortest stretch nearest the notes, the longer over it, and what has no words last', () => {
        const seated = seatAll(written, options(), bounds);
        expect(seated.map((seat) => seat.item)).toEqual(['short', 'long', 'draft']);
        const [short, long, draft] = seated;
        expect(short.spot.y).toBe(280 - 5);
        expect(long.spot.y).toBe(200 - 5);
        // The draft would sit where the long one's brace is, and goes over its words.
        expect(draft.spot.y).toBeLessThan(long.spot.words!.y - LANE / 2);
        expect(draft.spot.words).toBeNull();
    });

    it('hands each its path where it sits', () => {
        for (const seat of seatAll(written, options(), bounds)) expect(seat.path).toBe(markPath(seat.mark, seat.spot));
    });

    it('leaves out what has no place on the roll', () => {
        expect(seatAll([written[2], written[4]], options(), bounds)).toEqual([]);
    });
});

describe('lanesOf', () => {
    it('writes the remarks about the whole piece one after another', () => {
        expect(lanesOf([100, 50], 8, 600)).toEqual({
            places: [
                { x: 8, row: 0 },
                { x: 8 + 100 + 26, row: 0 },
            ],
            rows: 1,
        });
    });

    it('starts a new row where the next would run past the edge', () => {
        const { places, rows } = lanesOf([300, 250, 100, 500], 8, 600);
        expect(places).toEqual([
            { x: 8, row: 0 },
            { x: 334, row: 0 },
            { x: 8, row: 1 },
            { x: 8, row: 2 },
        ]);
        expect(rows).toBe(3);
    });

    it('gives words wider than the roll a row to themselves all the same', () => {
        expect(lanesOf([900, 900], 8, 600).places).toEqual([
            { x: 8, row: 0 },
            { x: 8, row: 1 },
        ]);
    });

    it('takes no rows for no remarks', () => {
        expect(lanesOf([], 8, 600)).toEqual({ places: [], rows: 0 });
    });
});

describe('shown', () => {
    it('writes a remark on one line', () => {
        expect(shown('steady tempo\n  on half bars')).toBe('steady tempo on half bars');
    });

    it('cuts a long one short, and says so', () => {
        const long = 'x'.repeat(80);
        expect(shown(long)).toBe(`${'x'.repeat(62)}…`);
        expect(shown('x'.repeat(64))).toBe('x'.repeat(64));
    });
});

describe('measurer', () => {
    it('estimates by the letters and the size where nothing can measure', () => {
        const measure = measurer('16px "EB Garamond", serif');
        expect(measure('')).toBe(0);
        expect(measure('abcd')).toBeGreaterThan(measure('ab'));
        expect(measure('steady tempo')).toBeCloseTo(12 * 16 * 0.45, 6);
        expect(measurer('italic 400 20px serif')('ab')).toBeCloseTo(2 * 20 * 0.45, 6);
    });
});
