/**
 * What the rubato, ornament and articulation charts are drawn from, checked against the
 * published performance and the values its definitions state.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPerformance } from '../utils/mpm';
import { readMeter } from '../utils/score';
import { publishedPath } from '../test/published';
import { readScoreNotes } from './band/bandMei';
import {
    articulate,
    articulatedNotes,
    articulationCharacter,
    msPerTickAt,
    notesAt,
    rollOf,
    rubatoCharacter,
    rubatoComb,
} from './instructionShapes';

const msm = readFileSync(publishedPath('score'), 'utf-8');
const mpm = readPerformance(readFileSync(publishedPath('performance'), 'utf-8'), readMeter(msm));
const notes = readScoreNotes(msm);
const onsets = notes.map((n) => n.date);
const instruction = (id: string) => {
    const found = mpm.byId(id);
    if (!found) throw new Error(`${id} is not in the published performance`);
    return found;
};

describe('a rubato’s comb', () => {
    it('moves the notes inside its frame and leaves the frame where it is', () => {
        // a quarter's frame at 1.4, struck at 1.4 and 1.4½, intensity 0.8794
        const rubato = mpm.rubatoOf(instruction('rubato_2880'))!;
        const teeth = rubatoComb(rubato, onsets);
        expect(teeth.map((t) => t.written)).toEqual([0, 0.5]);
        expect(teeth[0].played).toBe(0);
        expect(teeth[1].played).toBeCloseTo(Math.pow(0.5, 0.8794), 6);
        expect(rubatoCharacter(rubato)).toBe('long–short');
    });

    it('says when the window starts late', () => {
        const rubato = mpm.rubatoOf(instruction('rubato_7920'))!; // lateStart 0.0451
        expect(rubatoComb(rubato, onsets)[0].played).toBeCloseTo(0.0451, 6);
        expect(rubatoCharacter(rubato)).toBe('long–short · starts 5 % late');
    });

    it('shows a frame by its quarters when it has no notes to move', () => {
        const rubato = mpm.rubatoOf(instruction('rubato_2880'))!;
        expect(rubatoComb(rubato, []).map((t) => t.written)).toEqual([0, 0.25, 0.5, 0.75]);
    });
});

describe('a rolled chord', () => {
    it('rolls upwards into the beat, the lowest note softest', () => {
        // def_global_ornament_4320: frame.start -132.7702 over 132.7702, intensity 1.7201;
        // a gradient from -1 to 0 at scale 10
        const at = instruction('ornament_4320');
        const roll = rollOf(mpm.ornamentOf(at)!, notesAt(at, notes))!;
        expect(roll.unit).toBe('ticks');
        const pitches = roll.notes.map((n) => n.pitch);
        expect(pitches).toEqual([...pitches].sort((a, b) => a - b));
        expect(roll.notes[0].offset).toBeCloseTo(-132.7702, 4);
        expect(roll.notes.at(-1)!.offset).toBeCloseTo(0, 4);
        expect(roll.notes[1].offset).toBeCloseTo(-132.7702 + Math.pow(1 / 3, 1.7201) * 132.7702, 4);
        expect(roll.notes[0].velocity).toBeCloseTo(-10, 6);
        expect(roll.notes.at(-1)!.velocity).toBeCloseTo(0, 6);
    });

    it('gives a tick its length by the tempo in force', () => {
        const ms = msPerTickAt(mpm, 4320);
        expect(ms).not.toBeNull();
        // The piece moves between about 40 and 80 quarters a minute.
        expect(ms! * 720).toBeGreaterThan(60000 / 85);
        expect(ms! * 720).toBeLessThan(60000 / 35);
    });
});

describe('an articulated note', () => {
    it('holds a note for the absolute duration its definition states', () => {
        const articulation = mpm.articulationOf(instruction('articulation_1440'))!; // absoluteDuration 470.0499
        const note = articulatedNotes(articulation, notes)[0];
        expect(note.id).toBe('n1obi0t8');
        const played = articulate(articulation, note);
        expect(played.duration).toBeCloseTo(470.0499, 4);
        expect(played.velocity).toBe(1);
        expect(articulationCharacter(played, note.duration)).toBe(`shortened to ${String(Math.round((470.0499 / note.duration) * 100))} %`);
    });

    it('plays a note louder by the factor its definition states', () => {
        const articulation = mpm.articulationOf(instruction('articulation_56520'))!; // relativeVelocity 1.1951
        const note = articulatedNotes(articulation, notes)[0];
        const played = articulate(articulation, note);
        expect(played.velocity).toBeCloseTo(1.1951, 6);
        expect(played.duration).toBe(note.duration);
        expect(articulationCharacter(played, note.duration)).toBe('held its full length · 20 % louder');
    });
});
