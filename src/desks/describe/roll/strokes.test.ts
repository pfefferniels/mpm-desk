import { describe, expect, it } from 'vitest';
import type { NoteRect, PlacedNote } from './geometry';
import { aboutOf, caughtBy, endOf, hasMoved, isFlat, notesOf, wholePiece, type Stroke } from './strokes';
import type { About, RollNote } from './types';

const note = (id: string, date: number, pitch = 60, part = 1): RollNote => ({
    id,
    part,
    staff: part === 1 ? 'treble' : 'bass',
    pitch,
    letter: 'c',
    alter: 0,
    date,
    duration: 720,
    played: { ms: 0, msEnd: 1, velocity: 64 },
    rendered: { ms: 0, msEnd: 1, velocity: 64 },
});

const placed = (entry: RollNote, x: number, y: number, w = 40): PlacedNote => {
    const now: NoteRect = { x, y, w, h: 10, ink: 0.7 };
    return { note: entry, y: y + 5, now, was: now, shadowed: false, arrived: null, ledgers: [], accidental: null };
};

/** A beat every hundred pixels: a melody over a bass, and a chord on the third beat. */
const melody = [note('m0', 0, 72), note('m1', 720, 74), note('m2', 1440, 76), note('m3', 2160, 77)];
const bass = [note('b0', 0, 48, 2), note('b2', 1440, 52, 2)];
const all = [...melody, ...bass];
const roll = [
    placed(melody[0], 0, 100),
    placed(melody[1], 100, 90),
    placed(melody[2], 200, 80),
    placed(melody[3], 300, 70),
    placed(bass[0], 0, 300, 180),
    placed(bass[1], 200, 280, 180),
];

const stroke = (x0: number, y0: number, x1: number, y1: number, ruler = false): Stroke => ({ x0, y0, x1, y1, ruler });

describe('reading a stroke', () => {
    it('takes a press that hardly moves for a click', () => {
        expect(hasMoved(stroke(100, 100, 103, 97))).toBe(false);
        expect(hasMoved(stroke(100, 100, 105, 100))).toBe(true);
        expect(hasMoved(stroke(100, 100, 100, 95))).toBe(true);
    });

    it('takes a stroke that stays level for a passage, and one that goes up or down for a box', () => {
        expect(isFlat(stroke(100, 100, 400, 110))).toBe(true);
        expect(isFlat(stroke(100, 100, 400, 85))).toBe(true);
        expect(isFlat(stroke(100, 100, 400, 116))).toBe(false);
        expect(isFlat(stroke(100, 100, 400, 20))).toBe(false);
    });

    it('takes any stroke along the ruler for a passage', () => {
        expect(isFlat(stroke(100, 10, 400, 300, true))).toBe(true);
    });
});

describe('caughtBy', () => {
    const ids = (caught: ReturnType<typeof caughtBy>) => caught?.notes.map((entry) => entry.id);

    it('takes every note beginning under a flat stroke, in both hands, whatever height it is drawn at', () => {
        const caught = caughtBy(stroke(90, 500, 260, 505), roll);
        expect(caught?.kind).toBe('span');
        expect(ids(caught)).toEqual(['m1', 'm2', 'b2']);
    });

    it('goes by where a note begins: a long note sounding on under the stroke is not in it', () => {
        // The first bass note is still sounding at 150; it began at 0.
        expect(ids(caughtBy(stroke(90, 500, 160, 505), roll))).toEqual(['m1']);
        // A stroke that only just reaches the head of a note has it.
        expect(ids(caughtBy(stroke(150, 500, 205, 505), roll))).toEqual(['m2', 'b2']);
    });

    it('reads the same from right to left', () => {
        expect(ids(caughtBy(stroke(260, 505, 90, 500), roll))).toEqual(['m1', 'm2', 'b2']);
    });

    it('takes only the notes a tall stroke reaches down to: a box', () => {
        const caught = caughtBy(stroke(90, 60, 260, 120), roll);
        expect(caught?.kind).toBe('box');
        expect(ids(caught)).toEqual(['m1', 'm2']);
        expect(ids(caughtBy(stroke(260, 320, 90, 250), roll))).toEqual(['b2']);
    });

    it('calls a box that holds every note of its stretch a passage', () => {
        const caught = caughtBy(stroke(90, 60, 260, 320), roll);
        expect(caught?.kind).toBe('span');
        expect(ids(caught)).toEqual(['m1', 'm2', 'b2']);
    });

    it('catches nothing on empty paper', () => {
        expect(caughtBy(stroke(500, 100, 700, 105), roll)).toBeNull();
        expect(caughtBy(stroke(90, 150, 260, 200), roll)).toBeNull();
    });
});

describe('aboutOf', () => {
    it('runs from the first note in hand to the next date of the score after the last', () => {
        expect(aboutOf('span', [melody[1], melody[2], bass[1]], all, 2880)).toEqual<About>({
            kind: 'span',
            from: 720,
            to: 2160,
            notes: ['m1', 'b2', 'm2'],
        });
    });

    it('names the notes in the order of the score: by date, and from the bottom of a chord', () => {
        expect(aboutOf('box', [melody[2], bass[1], melody[0], bass[0]], all, 2880).notes).toEqual(['b0', 'm0', 'b2', 'm2']);
    });

    it('runs to the end of the piece when the last note in hand is the last of all', () => {
        expect(aboutOf('notes', [melody[3]], all, 2880)).toEqual<About>({ kind: 'notes', from: 2160, to: 2880, notes: ['m3'] });
    });

    it('makes an arrow of two notes one after the other, the earlier first however it was drawn', () => {
        expect(aboutOf('arrow', [melody[3], melody[1]], all, 2880)).toEqual<About>({
            kind: 'arrow',
            from: 720,
            to: 2880,
            notes: ['m1', 'm3'],
        });
    });

    it('makes a set of notes of an arrow that is none: within one chord, or of more than two', () => {
        expect(aboutOf('arrow', [melody[2], bass[1]], all, 2880).kind).toBe('notes');
        expect(aboutOf('arrow', [melody[0], melody[1], melody[2]], all, 2880).kind).toBe('notes');
    });

    it('is about the whole piece with nothing in hand', () => {
        expect(aboutOf('span', [], all, 2880)).toEqual(wholePiece(2880));
        expect(wholePiece(2880)).toEqual<About>({ kind: 'piece', from: 0, to: 2880, notes: [] });
    });
});

describe('notesOf', () => {
    const ids = all;

    it('takes a passage and an arrow by their stretch, the end left out', () => {
        expect(notesOf({ kind: 'span', from: 720, to: 2160, notes: [] }, ids)).toEqual(['m1', 'm2', 'b2']);
        expect(notesOf({ kind: 'arrow', from: 0, to: 1440, notes: ['m0', 'm1'] }, ids)).toEqual(['m0', 'm1', 'b0']);
    });

    it('takes a set and a box by the notes they name', () => {
        expect(notesOf({ kind: 'notes', from: 0, to: 2880, notes: ['m3'] }, ids)).toEqual(['m3']);
        expect(notesOf({ kind: 'box', from: 0, to: 2880, notes: ['b0', 'b2'] }, ids)).toEqual(['b0', 'b2']);
    });

    it('singles nothing out for the whole piece', () => {
        expect(notesOf(wholePiece(2880), ids)).toEqual([]);
    });
});

describe('endOf', () => {
    it('is where the last bar ends, or the last note if that is later', () => {
        expect(endOf(all, [{ to: 2880 }, { to: 5760 }])).toBe(5760);
        expect(endOf(all, [{ to: 2160 }])).toBe(2880);
        expect(endOf([], [])).toBe(0);
    });
});
