import { describe, expect, it } from 'vitest';
import {
    apart,
    barLinesOf,
    beatLinesOf,
    clockOf,
    describedOf,
    frameOf,
    HEAD,
    lastMs,
    liftOf,
    loudness,
    msOf,
    notationOf,
    noteAt,
    PEDAL,
    pedalRowsOf,
    pedalY,
    placeNotes,
    reachOf,
    rectOf,
    rowOf,
    scaleOf,
    solid,
    STAFF_STEP,
    staffRows,
    tall,
    TOP,
    xOf,
    yOf,
    type Drawing,
    type Frame,
} from './geometry';
import { accidentalBaseline, accidentalSize, clefSize } from './smufl';
import { BASS, TREBLE } from './staff';
import type { RollNote, Sounded } from './types';

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const KEYS = [0, 2, 4, 5, 7, 9, 11];

/** A natural note by its staff position (see `stepOf`), sounding for half a second. */
const note = (id: string, staff: 'treble' | 'bass', step: number, over: Partial<RollNote> = {}): RollNote => {
    const sounded: Sounded = { ms: 1000, msEnd: 1500, velocity: 64 };
    return {
        id,
        part: staff === 'treble' ? 1 : 2,
        staff,
        pitch: (Math.floor(step / 7) + 1) * 12 + KEYS[step % 7],
        letter: LETTERS[step % 7],
        alter: 0,
        date: 0,
        duration: 720,
        played: sounded,
        rendered: sounded,
        ...over,
    };
};

/** Two hands that keep to their staves: C4 to A5 above, F2 to C4 below. */
const piece = [note('t-low', 'treble', 28), note('t-high', 'treble', 40), note('b-low', 'bass', 17), note('b-high', 'bass', 28)];

const frameFor = (notes: readonly RollNote[], height: number, staff = true, pedalRows = 0): Frame =>
    frameOf({ height, pedalRows, staff, reach: notationOf(notes, []).reach });

describe('notationOf', () => {
    it('places every note by its spelling on its own staff', () => {
        const { written } = notationOf(piece, []);
        expect(written.get('t-low')).toMatchObject({ staff: 'treble', step: 28, pitch: 60 });
        expect(written.get('b-high')).toMatchObject({ staff: 'bass', step: 28, pitch: 60 });
    });

    it('reads the key signature off the notes, and spells a grace note by it', () => {
        const flat = (id: string): RollNote => ({ ...note(id, 'treble', 34), alter: -1, pitch: 70 });
        const { signature, written } = notationOf([flat('a'), flat('b')], [{ id: 'g', pitch: 46, staff: 'bass', ms: 0 }]);
        expect([...signature]).toEqual([['b', -1]]);
        expect(written.get('g')).toMatchObject({ staff: 'bass', letter: 'b', alter: -1, step: 20 });
    });
});

describe('reachOf', () => {
    it('shows each staff whole, and a position beyond its outer lines, whatever is written on it', () => {
        const reach = reachOf([{ staff: 'treble', step: 34, pitch: 71, letter: 'b', alter: 0 }]);
        expect(reach.treble).toEqual({ lo: TREBLE[0] - 1, hi: TREBLE[4] + 1 });
        expect(reach.bass).toEqual({ lo: BASS[0] - 1, hi: BASS[4] + 1 });
    });

    it('reaches as far as the notes of each staff go', () => {
        const { reach } = notationOf(piece, []);
        expect(reach.treble).toEqual({ lo: 28, hi: 40 });
        expect(reach.bass).toEqual({ lo: 17, hi: 28 });
        expect(reach.keys).toEqual([41, 81]);
    });
});

describe('frameOf, on the grand staff', () => {
    it('never gives a staff position more than its 8.5 pixels', () => {
        for (const height of [300, 500, 800, 1600]) {
            expect(frameFor(piece, height).rowHeight).toBeLessThanOrEqual(STAFF_STEP);
        }
        expect(frameFor(piece, 1600).rowHeight).toBe(STAFF_STEP);
    });

    it('makes the positions smaller where the height is short, and never smaller than three pixels', () => {
        const short = frameFor(piece, 300);
        expect(short.rowHeight).toBeLessThan(STAFF_STEP);
        expect(short.rowHeight).toBeGreaterThanOrEqual(3);
        expect(frameFor(piece, 60).rowHeight).toBe(3);
    });

    it('lifts the treble staff clear of the bass, whatever the height', () => {
        const { written } = notationOf(piece, []);
        const rowOfNote = (frame: Frame, id: string) => rowOf(frame, written.get(id)!);
        for (const height of [60, 300, 500, 800, 1600]) {
            const frame = frameFor(piece, height);
            // The lowest note of the upper staff stands at least three positions over the highest of the lower.
            expect(rowOfNote(frame, 't-low') - rowOfNote(frame, 'b-high')).toBeGreaterThanOrEqual(3);
            expect(yOf(frame, rowOfNote(frame, 't-low'))).toBeLessThan(yOf(frame, rowOfNote(frame, 'b-high')));
            // And the staves themselves never share a line.
            expect(TREBLE[0] + frame.shift - BASS[4]).toBeGreaterThanOrEqual(6);
        }
    });

    it('draws the same key on two staves in two places: each note on the staff it is written on', () => {
        const frame = frameFor(piece, 800);
        const { written } = notationOf(piece, []);
        // Both are middle C.
        expect(written.get('t-low')!.pitch).toBe(written.get('b-high')!.pitch);
        expect(rowOf(frame, written.get('t-low')!)).toBe(28 + frame.shift);
        expect(rowOf(frame, written.get('b-high')!)).toBe(28);
        expect(liftOf(frame, 'treble')).toBe(frame.shift);
        expect(liftOf(frame, 'bass')).toBe(0);
    });

    it('shares the height that is left between the gap and the margins', () => {
        const tight = frameFor(piece, 420);
        const roomy = frameFor(piece, 700);
        // More height sets the staves further apart, and leaves more above and below them.
        expect(roomy.shift).toBeGreaterThan(tight.shift);
        expect(roomy.pad).toBeGreaterThan(0);
        // Rows, gap and both margins make up the room there is under the remarks' share.
        const rows = roomy.high - roomy.low + 1;
        expect(rows * roomy.rowHeight + 2 * roomy.pad).toBeCloseTo(roomy.bottom - roomy.top - HEAD, 6);
    });

    it('does not set the staves apart without end', () => {
        const least = frameFor(piece, 60).shift;
        expect(frameFor(piece, 5000).shift).toBe(least + 18);
    });

    it('puts the top row under the room for the remarks and the bottom row over the pedals', () => {
        const frame = frameFor(piece, 700, true, 2);
        expect(frame.top).toBe(TOP);
        expect(frame.bottom).toBe(700 - 8 - 2 * (PEDAL + 4));
        expect(yOf(frame, frame.high) - frame.rowHeight / 2).toBeCloseTo(frame.top + HEAD + frame.pad, 6);
        expect(yOf(frame, frame.low) + frame.rowHeight / 2).toBeCloseTo(frame.bottom - frame.pad, 6);
        expect(pedalY(frame, 0)).toBe(frame.bottom + 6);
        expect(pedalY(frame, 1) - pedalY(frame, 0)).toBe(PEDAL + 4);
    });

    it('has ten staff lines, evenly two positions apart within a staff', () => {
        const frame = frameFor(piece, 800);
        const ys = staffRows(frame).map((row) => yOf(frame, row));
        expect(ys).toHaveLength(10);
        for (const i of [0, 1, 2, 3, 5, 6, 7, 8]) expect(ys[i] - ys[i + 1]).toBeCloseTo(2 * frame.rowHeight, 6);
        // The treble staff is the upper one.
        expect(ys[5]).toBeLessThan(ys[4]);
    });
});

describe('frameOf, key by key', () => {
    it('gives every key from the lowest to the highest a row, and the rows the height', () => {
        const frame = frameFor(piece, 600, false);
        expect([frame.low, frame.high]).toEqual([41, 81]);
        expect(frame.shift).toBe(0);
        expect(frame.rowHeight * (81 - 41 + 1)).toBeCloseTo(frame.bottom - frame.top - HEAD, 6);
        expect(frame.unit).toBe(frame.rowHeight);
    });

    it('draws a note in the row of its key, whichever staff it is written on', () => {
        const frame = frameFor(piece, 600, false);
        const { written } = notationOf(piece, []);
        expect(rowOf(frame, written.get('t-low')!)).toBe(60);
        expect(rowOf(frame, written.get('b-high')!)).toBe(60);
        expect(yOf(frame, 61)).toBeLessThan(yOf(frame, 60));
    });
});

describe('the loudness scale', () => {
    // A recording whose median velocity is 40 and whose loudest notes are at 80.
    const velocities = [...Array.from({ length: 49 }, (_, i) => 30 + (i % 11)), ...Array.from({ length: 49 }, (_, i) => 40 + (i % 11)), 80, 80, 80];
    const scale = scaleOf(velocities);
    const frame = frameFor(piece, 800);

    it('takes the median velocity of the notes as played for one unit', () => {
        expect(scale.level).toBe(40);
        expect(loudness(scale, 40)).toBe(0);
        expect(tall(frame, scale, 1, 40)).toBeCloseTo(frame.unit, 10);
    });

    it('draws the 98th percentile three units tall', () => {
        expect(loudness(scale, 80)).toBeCloseTo(2, 10);
        expect(tall(frame, scale, 1, 80)).toBeCloseTo(3 * frame.unit, 10);
    });

    it('is logarithmic: every doubling of the velocity adds the same', () => {
        expect(loudness(scale, 80) - loudness(scale, 40)).toBeCloseTo(loudness(scale, 40) - loudness(scale, 20), 10);
        expect(loudness(scale, 20)).toBeCloseTo(-loudness(scale, 80), 10);
    });

    it('never lets a louder note be lower or paler than a softer one', () => {
        for (let velocity = 1; velocity < 127; velocity++) {
            expect(loudness(scale, velocity + 1)).toBeGreaterThan(loudness(scale, velocity));
            expect(tall(frame, scale, 1, velocity + 1)).toBeGreaterThanOrEqual(tall(frame, scale, 1, velocity));
            expect(solid(scale, velocity + 1)).toBeGreaterThanOrEqual(solid(scale, velocity));
        }
        expect(tall(frame, scale, 1, 60)).toBeGreaterThan(tall(frame, scale, 1, 45));
        expect(solid(scale, 60)).toBeGreaterThan(solid(scale, 45));
    });

    it('keeps a note between a sliver and six units, and between pale and solid', () => {
        expect(tall(frame, scale, 4, 1)).toBeCloseTo(0.3 * frame.unit, 10);
        expect(tall(frame, scale, 4, 127)).toBeCloseTo(6 * frame.unit, 10);
        expect(solid(scale, 1)).toBe(0.3);
        expect(solid(scale, 127)).toBe(1);
        expect(solid(scale, 40)).toBeCloseTo(0.7, 10);
    });

    it('lets the gain say how much taller a louder note is, and leaves the level alone', () => {
        expect(tall(frame, scale, 0.5, 80)).toBeCloseTo(2 * frame.unit, 10);
        expect(tall(frame, scale, 2, 80)).toBeCloseTo(5 * frame.unit, 10);
        expect(tall(frame, scale, 2, 40)).toBeCloseTo(frame.unit, 10);
        // The opacity does not follow the gain.
        expect(solid(scale, 80)).toBeCloseTo(1, 10);
    });

    it('still has a scale for a recording at one level, or with no notes at all', () => {
        const flat = scaleOf([50, 50, 50]);
        expect(loudness(flat, 50)).toBe(0);
        expect(Number.isFinite(loudness(flat, 100))).toBe(true);
        expect(loudness(scaleOf([]), 64)).toBe(0);
    });
});

describe('along the roll', () => {
    it('draws a second as many pixels wide as the zoom says', () => {
        expect(xOf(0, 20)).toBe(0);
        expect(xOf(1000, 20)).toBe(20);
        expect(xOf(2500, 40)).toBe(100);
    });

    it('reads a place back as the moment it shows', () => {
        for (const ms of [0, 1, 999, 123456]) expect(msOf(xOf(ms, 28), 28)).toBeCloseTo(ms, 6);
    });

    it('places a score date between the beats either side of it, and past the last as the last two run', () => {
        const clock = clockOf([
            { date: 0, ms: 1000 },
            { date: 720, ms: 2000 },
            { date: 1440, ms: 4000 },
        ]);
        expect(clock(0)).toBe(1000);
        expect(clock(360)).toBe(1500);
        expect(clock(1080)).toBe(3000);
        expect(clock(2160)).toBe(6000);
        expect(clock(-720)).toBe(0);
    });

    it('takes a date for its own time where there are no beats to place it', () => {
        expect(clockOf([])(500)).toBe(500);
        expect(clockOf([{ date: 0, ms: 300 }])(500)).toBe(300);
    });

    it('ends where the last sound or the last beat does', () => {
        const pedals = { played: [{ kind: 'sustain' as const, ms: 0, msEnd: 9000 }], rendered: [] };
        expect(lastMs(piece, [{ ms: 0 }, { ms: 4000 }], { played: [], rendered: [] })).toBe(4000);
        expect(lastMs([note('a', 'treble', 30, { rendered: { ms: 0, msEnd: 7000, velocity: 1 } })], [], { played: [], rendered: [] })).toBe(7000);
        expect(lastMs(piece, [{ ms: 4000 }], pedals)).toBe(9000);
    });
});

describe('the bar and beat lines', () => {
    const bars = [
        { n: 1, from: 0, to: 2880 },
        { n: 2, from: 2880, to: 5760 },
        { n: 3, from: 5760, to: 8640 },
    ];
    const beats = Array.from({ length: 13 }, (_, i) => ({ date: i * 720, ms: i * 500 }));
    const xAt = (date: number) => date / 10;

    it('stands a bar line where its first beat falls, and marks it where the tempo is only assumed', () => {
        const lines = barLinesOf(bars, [{ from: 2880, to: 5760 }], xAt);
        expect(lines.map((line) => line.x)).toEqual([0, 288, 576]);
        expect(lines.map((line) => line.assumed)).toEqual([false, true, false]);
    });

    it('leaves out the number of a bar that would run into the one before', () => {
        expect(barLinesOf(bars, [], xAt).map((line) => line.numbered)).toEqual([true, true, true]);
        expect(barLinesOf(bars, [], (date) => date / 200).map((line) => line.numbered)).toEqual([true, false, true]);
    });

    it('draws the beats inside the bars, not the ones the bar lines stand on', () => {
        expect(beatLinesOf(bars, beats, [], xAt)).toEqual([72, 144, 216, 360, 432, 504, 648, 720, 792]);
    });

    it('draws no beats where the tempo is assumed, nor where they would stand too close to tell', () => {
        expect(beatLinesOf(bars, beats, [{ from: 0, to: 2880 }], xAt)).toEqual([360, 432, 504, 648, 720, 792]);
        expect(beatLinesOf(bars, beats, [], (date) => date / 100)).toEqual([]);
    });

    it('takes for described whatever of the piece is not assumed', () => {
        expect(describedOf([], 8640)).toEqual([[0, 8640]]);
        expect(describedOf([{ from: 0, to: 8640 }], 8640)).toEqual([]);
        expect(
            describedOf(
                [
                    { from: 5760, to: 8640 },
                    { from: 0, to: 720 },
                ],
                8640,
            ),
        ).toEqual([[720, 5760]]);
        expect(describedOf([{ from: 720, to: 2880 }], 8640)).toEqual([
            [0, 720],
            [2880, 8640],
        ]);
    });
});

describe('the box of a note', () => {
    const frame = frameFor(piece, 800);
    const drawing: Drawing = { frame, scale: scaleOf([40, 40, 80]), gain: 1, pxPerSecond: 20 };

    it('is as long as the note sounded, as tall as it was loud, and centred on its row', () => {
        const rect = rectOf({ ms: 1000, msEnd: 3000, velocity: 40 }, 34, drawing);
        expect(rect.x).toBe(20);
        expect(rect.w).toBe(40);
        expect(rect.h).toBeCloseTo(frame.unit, 10);
        expect(rect.y + rect.h / 2).toBeCloseTo(yOf(frame, 34), 10);
        expect(rect.ink).toBeCloseTo(0.7, 10);
    });

    it('is never too short to see', () => {
        expect(rectOf({ ms: 1000, msEnd: 1001, velocity: 40 }, 34, drawing).w).toBe(2);
    });

    it('stays on its row however loud the note', () => {
        const soft = rectOf({ ms: 0, msEnd: 500, velocity: 20 }, 34, drawing);
        const loud = rectOf({ ms: 0, msEnd: 500, velocity: 100 }, 34, drawing);
        expect(loud.h).toBeGreaterThan(soft.h);
        expect(loud.y + loud.h / 2).toBeCloseTo(soft.y + soft.h / 2, 10);
    });
});

describe('apart', () => {
    const rect = { x: 100, y: 50, w: 40, h: 10 };

    it('takes a shadow for covered where it differs by less than can be seen', () => {
        expect(apart(rect, rect)).toBe(false);
        expect(apart(rect, { x: 101, y: 50, w: 40, h: 10.5 })).toBe(false);
    });

    it('tells a shadow that begins elsewhere, ends elsewhere, or is taller', () => {
        expect(apart(rect, { ...rect, x: 102, w: 38 })).toBe(true);
        expect(apart(rect, { ...rect, w: 43 })).toBe(true);
        expect(apart(rect, { ...rect, h: 11 })).toBe(true);
    });
});

describe('placeNotes', () => {
    const sharp: RollNote = { ...note('sharp', 'treble', 31), alter: 1, pitch: 66 };
    const moved = note('moved', 'treble', 34, { rendered: { ms: 1200, msEnd: 1700, velocity: 64 } });
    const louder = note('louder', 'bass', 22, { rendered: { ms: 1000, msEnd: 1500, velocity: 40 } });
    const corrected = note('corrected', 'bass', 20, { arrived: { ms: 800, msEnd: 1300, velocity: 64 } });
    const notes = [...piece, sharp, moved, louder, corrected];
    const notation = notationOf(notes, []);
    const place = (staff: boolean) => {
        const frame = frameOf({ height: 800, pedalRows: 0, staff, reach: notation.reach });
        const drawing: Drawing = { frame, scale: scaleOf(notes.map((n) => n.played.velocity)), gain: 1, pxPerSecond: 20 };
        return new Map(placeNotes(notes, notation, drawing).map((entry) => [entry.note.id, entry]));
    };

    it('gives a note a shadow only where it was played otherwise than it is rendered', () => {
        const placed = place(true);
        expect(placed.get('t-low')!.shadowed).toBe(false);
        expect(placed.get('moved')!.shadowed).toBe(true);
        expect(placed.get('moved')!.was.x).toBe(20);
        expect(placed.get('moved')!.now.x).toBe(24);
        expect(placed.get('louder')!.shadowed).toBe(true);
        expect(placed.get('louder')!.was.h).toBeGreaterThan(placed.get('louder')!.now.h);
    });

    it('keeps note and shadow on the one row', () => {
        const { now, was, y } = place(true).get('louder')!;
        expect(now.y + now.h / 2).toBeCloseTo(y, 10);
        expect(was.y + was.h / 2).toBeCloseTo(y, 10);
    });

    it('remembers where the roll had a corrected note', () => {
        const placed = place(true);
        expect(placed.get('corrected')!.arrived?.x).toBe(16);
        expect(placed.get('moved')!.arrived).toBeNull();
    });

    it('gives ledger lines to the notes that stand off their staff, each line where it runs', () => {
        const placed = place(true);
        const frame = frameOf({ height: 800, pedalRows: 0, staff: true, reach: notation.reach });
        expect(placed.get('t-low')!.ledgers).toEqual([yOf(frame, 28 + frame.shift)]);
        expect(placed.get('b-high')!.ledgers).toEqual([yOf(frame, 28)]);
        expect(placed.get('t-high')!.ledgers).toEqual([yOf(frame, 40 + frame.shift)]);
        expect(placed.get('moved')!.ledgers).toEqual([]);
        // Middle C under the treble staff is not where middle C over the bass staff is.
        expect(placed.get('t-low')!.ledgers[0]).toBeLessThan(placed.get('b-high')!.ledgers[0]);
    });

    it('gives an accidental to the note that departs from the key signature, and to no other', () => {
        const placed = place(true);
        expect(placed.get('sharp')!.accidental).toBe(1);
        expect(placed.get('moved')!.accidental).toBeNull();
        // In a key with that sharp, the sharp is in the signature and a natural is the departure.
        const inKey = notationOf([sharp, { ...sharp, id: 'sharp2' }, note('nat', 'treble', 38)], []);
        const frame = frameOf({ height: 800, pedalRows: 0, staff: true, reach: inKey.reach });
        const drawn = placeNotes([sharp, note('nat', 'treble', 38)], inKey, { frame, scale: scaleOf([64]), gain: 1, pxPerSecond: 20 });
        expect(drawn.map((entry) => entry.accidental)).toEqual([null, 0]);
    });

    it('has neither ledger lines nor accidentals key by key', () => {
        const placed = place(false);
        expect(placed.get('t-low')!.ledgers).toEqual([]);
        expect(placed.get('sharp')!.accidental).toBeNull();
        // And the same key is in the same row for both hands.
        expect(placed.get('t-low')!.y).toBe(placed.get('b-high')!.y);
    });
});

describe('noteAt', () => {
    const quiet = note('quiet', 'treble', 34, {
        played: { ms: 1000, msEnd: 1500, velocity: 40 },
        rendered: { ms: 1000, msEnd: 1500, velocity: 40 },
    });
    const loud = note('loud', 'treble', 34, {
        played: { ms: 500, msEnd: 2500, velocity: 100 },
        rendered: { ms: 500, msEnd: 2500, velocity: 100 },
    });
    const late = note('late', 'bass', 22, { played: { ms: 3000, msEnd: 3500, velocity: 64 }, rendered: { ms: 4000, msEnd: 4500, velocity: 64 } });
    const notes = [quiet, loud, late];
    const notation = notationOf(notes, []);
    const frame = frameOf({ height: 800, pedalRows: 0, staff: true, reach: notation.reach });
    const placed = placeNotes(notes, notation, { frame, scale: scaleOf([40, 64, 100]), gain: 1, pxPerSecond: 20 });
    const y = yOf(frame, 34 + frame.shift);
    const low = yOf(frame, 22);

    it('finds the note under the pointer, with a little to spare around it', () => {
        expect(noteAt(placed, 85, low, true)?.note.id).toBe('late');
        expect(noteAt(placed, 79, low, true)?.note.id).toBe('late');
        expect(noteAt(placed, 76, low, true)).toBeNull();
    });

    it('takes the smaller of two notes that lie over one another', () => {
        expect(noteAt(placed, 25, y, true)?.note.id).toBe('quiet');
        expect(noteAt(placed, 45, y, true)?.note.id).toBe('loud');
    });

    it('finds a note by its shadow where the shadows are drawn, and not where they are not', () => {
        expect(noteAt(placed, 65, low, true)?.note.id).toBe('late');
        expect(noteAt(placed, 65, low, false)).toBeNull();
    });

    it('finds nothing on empty paper', () => {
        expect(noteAt(placed, 300, y, true)).toBeNull();
        expect(noteAt(placed, 25, y + 60, true)).toBeNull();
    });
});

describe('the pedal rows', () => {
    it('has a row for each pedal that was pressed or is moved, sustain first', () => {
        expect(pedalRowsOf({ played: [], rendered: [] })).toEqual([]);
        expect(
            pedalRowsOf({ played: [{ kind: 'soft', ms: 0, msEnd: 1 }], rendered: [{ kind: 'sustain', ms: 0, value: 127 }] }).map((row) => row.kind),
        ).toEqual(['sustain', 'soft']);
        expect(pedalRowsOf({ played: [{ kind: 'soft', ms: 0, msEnd: 1 }], rendered: [] })).toEqual([{ kind: 'soft', label: 'u.c.' }]);
    });
});

describe('the music font', () => {
    it('sets a clef at ten staff positions to the em, so that it fits its staff', () => {
        expect(clefSize(8.5)).toBe(85);
        expect(clefSize(3)).toBe(30);
    });

    it('draws an accidental to go with the boxes, and never too small to read', () => {
        expect(accidentalSize(8.5)).toBeCloseTo(35.7, 10);
        expect(accidentalSize(3)).toBe(20);
        expect(accidentalSize(20)).toBe(36);
    });

    it('sets an accidental two staff spaces of its own size over the baseline', () => {
        expect(accidentalBaseline(100, 30)).toBe(112);
    });
});
