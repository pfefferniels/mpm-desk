/**
 * Which notes are played for a remark and how loud, on two bars: the right hand in quarters
 * (`r0` to `r7`), the left hand a whole note to the bar (`l0`, `l1`).
 */
import { describe, expect, it } from 'vitest';
import type { Roll } from '../../../fitting/description/client';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import type { Subject } from './context';
import { aRun, places, QUARTER, step } from './fixture';
import {
    freshOf,
    gridOf,
    playedFor,
    playedFrom,
    soundsOf,
    timesOf,
    wroteOf,
    type Chosen,
} from './passage';

const run = aRun();
const { roll } = run;
const tempo = places().get('tempo')!;

const wrote = (...about: Subject[]) => ({ about: new Set(about), touched: [] });
/** The roll with the MPM's rendering `times` as slow. */
const slowed = (times: number): Roll => ({
    ...roll,
    notes: roll.notes.map((note) => ({
        ...note,
        mpm: { ...note.mpm, ms: note.mpm.ms * times, msEnd: note.mpm.msEnd * times },
    })),
});
const levels = (chosen: Chosen | null) => Object.fromEntries(chosen?.gains ?? []);
const on = (id: string): DescribedPlace => {
    const { date } = roll.notes.find((note) => note.id === id)!;
    return { kind: 'notes', from: date, to: date + QUARTER, notes: [id] };
};

describe('what a remark wrote', () => {
    it('is read off the elements of its steps', () => {
        expect(wroteOf(run.remarks[0])).toEqual({
            elements: ['tempo_2880'],
            about: new Set(['tempo']),
            touched: [],
        });
    });

    it('names its subjects as the context rules do, and passes over what says nothing', () => {
        const report = {
            id: 'r',
            concrete: [],
            steps: [
                step([
                    '<rubato date="0" xml:id="a" />',
                    '<ornament date="0" name.ref="roll" xml:id="b" />',
                ]),
                step([
                    '<accentuationPattern date="0" xml:id="c" />',
                    '<movement date="0" xml:id="d" />',
                ]),
                step(['<asynchrony date="0" xml:id="e" />', '<style date="0" xml:id="f" />']),
            ],
        };
        expect(wroteOf(report).about).toEqual(new Set(['rubato', 'roll', 'accent', 'pedal']));
        expect(wroteOf(report).elements).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });

    it('takes an element since removed by its id, and the touched notes from the steps that wrote a touch', () => {
        const removed = { ...step([''], ['r1']), elements: ['dynamics_720'] };
        const touch = step(['<articulation date="1440" xml:id="art" />'], ['r2', 'r3']);
        const report = { id: 'r', concrete: [], steps: [removed, touch, step([], [], 'refused')] };
        expect(wroteOf(report)).toEqual({
            elements: ['dynamics_720', 'art'],
            about: new Set(['dynamics', 'touch']),
            touched: ['r2', 'r3'],
        });
    });

    it('is nothing where every step failed', () => {
        expect(wroteOf(run.remarks[1])).toEqual({ elements: [], about: new Set(), touched: [] });
    });
});

describe('the score as the context rules read it', () => {
    it('has every date once, the beats and the bars', () => {
        const grid = gridOf(roll);
        expect(grid.dates).toEqual([0, 720, 1440, 2160, 2880, 3600, 4320, 5040]);
        expect(grid.beats).toEqual([0, 720, 1440, 2160, 2880, 3600, 4320, 5040, 5760]);
        expect(grid.bars).toEqual([0, 2880]);
    });
});

describe('the notes played for a remark', () => {
    it('are its own, and what it takes around them: for a tempo two chords before and two after', () => {
        const chosen = playedFor(roll, tempo, wrote('tempo'))!;
        expect(chosen.own).toEqual(new Set(['r4', 'r5', 'l1']));
        // The whole note of the first bar is still sounding where the playing begins.
        expect(levels(chosen)).toEqual({
            r2: 1,
            r3: 1,
            r4: 1,
            r5: 1,
            r6: 1,
            r7: 1,
            l1: 1,
            l0: 0.7,
        });
        expect(chosen.held).toEqual(new Set(['l0']));
        expect(freshOf(roll.notes, chosen).map((note) => note.id)).toEqual([
            'r2',
            'r3',
            'r4',
            'r5',
            'r6',
            'r7',
            'l1',
        ]);
    });

    it('are fewer where the remark wrote nothing: the chord before and the chord after', () => {
        expect(levels(playedFor(roll, tempo, wrote()))).toEqual({
            r3: 1,
            r4: 1,
            r5: 1,
            r6: 1,
            l1: 1,
            l0: 0.7,
        });
    });

    it('hold the other hand back under single notes, so that they are heard in their line', () => {
        const chosen = playedFor(roll, on('r4'), wrote())!;
        expect(chosen.own).toEqual(new Set(['r4']));
        expect(levels(chosen)).toEqual({ r3: 1, r4: 1, r5: 1, l1: 0.55, l0: 0.7 * 0.55 });
    });

    it('leave the other hand as loud where loudness is what the remark is about', () => {
        expect(levels(playedFor(roll, on('r4'), wrote('dynamics')))).toEqual({
            r3: 1,
            r4: 1,
            r5: 1,
            l1: 1,
            l0: 0.7,
        });
    });

    it('reach no further than 2.6 s from the passage as the MPM has it, but for the nearest chord either side', () => {
        const fresh = (times: number) =>
            freshOf(roll.notes, playedFor(slowed(times), tempo, wrote('tempo'))!).map(
                (note) => note.id,
            );
        // Four times as slow, a quarter takes two seconds: the second chord after is out of reach.
        expect(fresh(4)).toEqual(['r3', 'r4', 'r5', 'r6', 'l1']);
        // Eight times as slow every chord is, and the nearest is played all the same.
        expect(fresh(8)).toEqual(['r3', 'r4', 'r5', 'r6', 'l1']);
        // Twice as slow nothing is.
        expect(fresh(2)).toHaveLength(7);
    });

    it('are none where its place holds no note', () => {
        const nowhere: DescribedPlace = { kind: 'span', from: 100, to: 200, notes: [] };
        expect(playedFor(roll, nowhere, wrote())).toBeNull();
        expect(playedFor(roll, { ...on('r0'), notes: ['gone'] }, wrote())).toBeNull();
    });

    it('are all of them from the line on, for a remark on the whole piece', () => {
        const chosen = playedFrom(roll, 1200)!;
        expect(levels(chosen)).toEqual({ r3: 1, r4: 1, r5: 1, r6: 1, r7: 1, l1: 1 });
        expect(chosen.own).toEqual(new Set(chosen.gains.keys()));
        expect(playedFrom(roll, 3600)).toBeNull();
    });
});

describe('the notes chosen, as the piano strikes them', () => {
    const chosen = playedFor(roll, tempo, wrote('tempo'))!;

    it('sound where the rendering has them, each at its level', () => {
        const keys = soundsOf(roll.notes, (note) => note.mpm, chosen);
        expect(keys.find((key) => key.id === 'r2')).toEqual({
            id: 'r2',
            pitch: 62,
            onsetMs: 1000,
            offsetMs: 1450,
            velocity: 60,
        });
        expect(keys.find((key) => key.id === 'l1')).toEqual({
            id: 'l1',
            pitch: 43,
            onsetMs: 2000,
            offsetMs: 3950,
            velocity: 60,
        });
        expect(keys).toHaveLength(8);
    });

    it('begin a held note with the first of the others, softer, and let it end when it did', () => {
        const keys = soundsOf(roll.notes, (note) => note.mpm, chosen);
        expect(keys.find((key) => key.id === 'l0')).toEqual({
            id: 'l0',
            pitch: 36,
            onsetMs: 1000,
            offsetMs: 1950,
            velocity: 42,
        });
    });

    it('leave a held note out that has ended by then', () => {
        const keys = soundsOf(
            roll.notes,
            (note) => (note.id === 'l0' ? { ...note.mpm, msEnd: 1040 } : note.mpm),
            chosen,
        );
        expect(keys.map((key) => key.id)).not.toContain('l0');
        expect(keys).toHaveLength(7);
    });
});

describe('when the playing begins and ends', () => {
    const sound = (ms: number, msEnd: number) => ({ ms, msEnd, velocity: 60 });

    it('begins a moment before the first sound, and ends after the last of the remark has', () => {
        expect(
            timesOf([sound(1000, 1450), sound(2000, 3950), sound(3500, 3950)], [sound(2000, 5000)]),
        ).toEqual({ from: 960, until: 5300 });
    });

    it('gives the last chord time to be heard where the remark ends sooner', () => {
        expect(timesOf([sound(1000, 1450), sound(3500, 3950)], [sound(1000, 1450)])).toEqual({
            from: 960,
            until: 4500,
        });
    });
});
