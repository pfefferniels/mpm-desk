/**
 * The instructions of one remark, brought out: a run's rendering with their dimensions of the
 * performance exaggerated and the rest damped, on that rendering's own clock.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
    bringOut,
    describe as runDescription,
    type BroughtOut,
    type DescribeRunOptions,
    type DescriptionRun,
} from '../../../src/fitting/description/index';
import type { Call } from '../../../src/model/Work';
import { bar, loadPublished, remark, step, type Published } from './published';

// Two bars that press forward and grow louder, described as a tempo and as a loudness.
const [FROM, TO] = [bar(16), bar(18)];
const DAMPED = 0.35;

let published: Published;
let document: Call[];
let result: DescriptionRun;
let plain: BroughtOut;
let tempo: string[];
let dynamics: string[];

const run = (calls: readonly Call[], options?: DescribeRunOptions) =>
    runDescription(published.alignment, calls, options);

beforeAll(() => {
    published = loadPublished();
    document = [
        ...published.choice,
        remark('r1', [
            step('FitTempo', { from: FROM, to: TO, shape: 'transition' }),
            step('InsertDynamics', { from: FROM, to: TO }),
        ]),
    ];
    result = run(document);
    plain = bringOut(result, [], 1, 1);
    [tempo, dynamics] = result.remarks[0]!.steps.map((report) => report.elements) as [
        string[],
        string[],
    ];
});

/** The notes of a rendering that the two bars hold, by their chord's date. */
const chords = (rendering: BroughtOut) => {
    const dates = new Map(result.roll.notes.map((note) => [note.id, note.date]));
    const inside = rendering.notes.filter((note) => {
        const date = dates.get(note.id);
        return date !== undefined && date >= FROM && date <= TO;
    });
    return [...Map.groupBy(inside, (note) => dates.get(note.id)!)].sort(([a], [b]) => a - b);
};
/** Ms from each chord of the two bars to the next. */
const gaps = (rendering: BroughtOut) => {
    const onsets = chords(rendering).map(([, chord]) => Math.min(...chord.map((note) => note.ms)));
    return onsets.slice(1).map((ms, i) => ms - onsets[i]!);
};
const velocities = (rendering: BroughtOut) =>
    chords(rendering).flatMap(([, chord]) => chord.map((note) => note.velocity));
const furthest = (a: number[], b: number[]) =>
    Math.max(...a.map((value, i) => Math.abs(value - b[i]!)));

describe('the instructions of one remark, brought out', () => {
    it('renders the run as it stands where no instruction is named', () => {
        expect(tempo).toHaveLength(1);
        expect(dynamics.length).toBeGreaterThan(0);
        expect(plain.spared).toEqual([]);
        expect(plain.pedal).toEqual([]);
        // The run lays each tempo's notes against the recording; the two clocks part by rounding only.
        const rendered = new Map(plain.notes.map((note) => [note.id, note]));
        for (const note of result.roll.notes) {
            const { ms, msEnd, velocity } = rendered.get(note.id)!;
            expect(velocity).toBe(note.mpm.velocity);
            expect(Math.abs(ms - note.mpm.ms)).toBeLessThan(0.1);
            expect(Math.abs(msEnd - note.mpm.msEnd)).toBeLessThan(0.1);
        }
        // Under one tempo from the first note on they are one clock, and nothing parts.
        const base = run(published.choice);
        const whole = new Map(bringOut(base, [], 1, 1).notes.map((note) => [note.id, note]));
        for (const note of base.roll.notes)
            expect(whole.get(note.id)).toEqual({ id: note.id, ...note.mpm });
    });

    it('exaggerates a tempo: the chords of its bars move in time, and so does the rest of the piece', () => {
        const out = bringOut(result, tempo, 1.8, DAMPED);
        expect(out.spared).toContain('tempo');
        expect(out.notes.map((note) => note.id)).toEqual(plain.notes.map((note) => note.id));
        expect(furthest(gaps(out), gaps(plain))).toBeGreaterThan(50);
        // A clock of its own: the piece no longer ends when the plain rendering does.
        const end = (rendering: BroughtOut) =>
            Math.max(...rendering.notes.map((note) => note.msEnd));
        expect(Math.abs(end(out) - end(plain))).toBeGreaterThan(1000);
    });

    it('exaggerates a loudness and damps the tempo, which is then not among the spared', () => {
        const out = bringOut(result, dynamics, 1.8, DAMPED);
        expect(out.spared).toContain('dynamics');
        expect(out.spared).not.toContain('tempo');
        expect(furthest(velocities(out), velocities(plain))).toBeGreaterThan(2);
        expect(out.notes.every((note) => note.msEnd > note.ms && note.velocity > 0)).toBe(true);
    });

    it('changes nothing at factor 1 with nothing damped, whatever is named', () => {
        const out = bringOut(result, [...tempo, ...dynamics], 1, 1);
        expect(out.notes).toEqual(plain.notes);
        expect(out.pedal).toEqual(plain.pedal);
    });

    it('keeps the factor to 1.9 and the damping to a twentieth', () => {
        expect(bringOut(result, tempo, 5, 0)).toEqual(bringOut(result, tempo, 1.9, 0.05));
        expect(bringOut(result, tempo, 0.2, 3).notes).toEqual(plain.notes);
    });

    it('passes over ids the document does not hold, and renders the run as it stands with none left', () => {
        const out = bringOut(result, [...tempo, 'tempo_1'], 1.8, DAMPED);
        expect(out).toEqual(bringOut(result, tempo, 1.8, DAMPED));
        expect(bringOut(result, ['tempo_1', 'nothing'], 1.8, DAMPED)).toEqual(plain);
    });

    it('renders the run as it stands where an id names no instruction', () => {
        const rolled = run([
            ...published.choice,
            remark('r1', [step('InsertTemporalSpread', { date: 1440 })]),
        ]);
        expect(rolled.mpm).toContain('xml:id="style_ornament_global"');
        const ids = ['style_ornament_global', ...rolled.remarks[0]!.steps[0]!.elements];
        expect(bringOut(rolled, ids, 1.8, DAMPED)).toEqual(bringOut(rolled, [], 1, 1));
    });

    it('gives each move of the sustaining pedal once, in order', () => {
        const pedalled = run([...published.choice, remark('r1', [step('InsertPedal')])]);
        const { pedal } = bringOut(pedalled, [], 1, 1);
        const move = ({ ms, value }: { ms: number; value: number }) => `${ms} ${value}`;
        // The run states a move once for every part and more; under its one tempo the clocks agree.
        const stated = pedalled.roll.pedals.mpm.filter(({ kind }) => kind === 'sustain').map(move);
        expect(pedal.length).toBeGreaterThan(10);
        expect(pedal.length).toBeLessThan(stated.length);
        expect(pedal.map(move)).toEqual([...new Set(stated)]);
        expect(pedal.every(({ ms }, i) => i === 0 || ms >= pedal[i - 1]!.ms)).toBe(true);
    });

    it('brings out the run it is handed, whatever was tried or run since', () => {
        const before = bringOut(result, tempo, 1.8, DAMPED);
        const tried = run(document, {
            trial: { remark: 'r1', steps: [step('FitDynamics', { from: FROM, to: TO })] },
        });
        run(published.choice);
        expect(bringOut(result, tempo, 1.8, DAMPED)).toEqual(before);
        expect(bringOut({ mpm: result.mpm, score: result.score }, tempo, 1.8, DAMPED)).toEqual(
            before,
        );

        // A trial's run is a run like any other, and is only brought out where it is the one handed
        // in: it holds no tempo of the remark, so there is nothing of it to bring out.
        expect(tried.mpm).not.toBe(result.mpm);
        const other = bringOut(tried, tempo, 1.8, DAMPED);
        expect(other.spared).toEqual([]);
        expect(other.notes).not.toEqual(before.notes);
    });
});
