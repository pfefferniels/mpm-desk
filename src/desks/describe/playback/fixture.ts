/**
 * A run small enough to be read, for the tests beside it: two bars of common time at 120, the
 * right hand in quarters over the left hand's two whole notes.
 *
 * The MPM renders a quarter every 500 ms. Every note was played 30 ms later than that and louder,
 * with a grace note before the second bar, the sustaining pedal over most of the first and the
 * soft pedal for a moment.
 */
import type {
    BroughtOut,
    DescriptionRun,
    RemarkReport,
    RollNote,
    StepReport,
} from '../../../fitting/description/client';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';

export const QUARTER = 720;
const QUARTER_MS = 500;
const LATE = 30;

/** Where the MPM has a date, in ms. */
const msAt = (date: number) => (date / QUARTER) * QUARTER_MS;

const note = (id: string, part: number, pitch: number, date: number, duration: number): RollNote => {
    const mpm = { ms: msAt(date), msEnd: msAt(date + duration) - 50, velocity: 60 };
    return {
        id,
        part,
        pitch,
        date,
        duration,
        ms: mpm.ms + LATE,
        msEnd: mpm.msEnd + LATE,
        velocity: 70,
        mpm,
        late: LATE,
        longMs: 0,
        loud: 10,
    };
};

/** `r0` to `r7`, a quarter each from middle C up; `l0` and `l1`, a bar each. */
const notes = (): RollNote[] => [
    ...Array.from({ length: 8 }, (_, i) => note(`r${i}`, 1, 60 + i, i * QUARTER, QUARTER)),
    note('l0', 2, 36, 0, 4 * QUARTER),
    note('l1', 2, 43, 4 * QUARTER, 4 * QUARTER),
];

export const step = (written: string[], evidence: string[] = [], error?: string): StepReport => ({
    calls: [],
    elements: written.map((tag) => / xml:id="([^"]+)"/.exec(tag)?.[1] ?? ''),
    written,
    definitions: [],
    evidence,
    fitted: [],
    range: null,
    ...(error !== undefined && { error }),
});

const remark = (id: string, steps: StepReport[]): RemarkReport => ({ id, concrete: [], steps });

/**
 * - `tempo`: the first half of the second bar, which it wrote a tempo for.
 * - `quiet`: the right hand's third note alone, of which it wrote nothing.
 * - `whole`: the whole piece, for which it wrote dynamics.
 */
export const aRun = (): DescriptionRun => ({
    mpm: '<mpm/>',
    score: '<msm/>',
    roll: {
        notes: notes(),
        graces: [{ id: 'g', group: 'g', principal: 'r4', pitch: 59, ms: 1950, velocity: 40 }],
        pedals: {
            played: [
                { kind: 'sustain', ms: 0, msEnd: 1800 },
                { kind: 'soft', ms: 0, msEnd: 400 },
            ],
            mpm: [
                { kind: 'sustain', ms: 0, value: 127 },
                { kind: 'sustain', ms: 1900, value: 0 },
            ],
        },
        beats: Array.from({ length: 9 }, (_, i) => ({ date: i * QUARTER, ms: msAt(i * QUARTER) })),
        assumed: { tempo: [], level: null, levelDates: [] },
        level: 60,
        end: 8 * QUARTER,
        timeSignatures: [{ date: 0, numerator: 4, denominator: 4 }],
    },
    remarks: [
        remark('tempo', [step(['<tempo date="2880" bpm="120" xml:id="tempo_2880" />'], ['r4', 'r5', 'l1'])]),
        remark('quiet', [step([], [], 'nothing to fit')]),
        remark('whole', [step(['<dynamics date="0" volume="60" xml:id="dynamics_0" />'])]),
    ],
    problems: [],
});

export const places = (): Map<string, DescribedPlace> =>
    new Map([
        ['tempo', { kind: 'span', from: 4 * QUARTER, to: 6 * QUARTER, notes: [] }],
        ['quiet', { kind: 'notes', from: 2 * QUARTER, to: 3 * QUARTER, notes: ['r2'] }],
        ['whole', { kind: 'piece', from: 0, to: 0, notes: [] }],
    ]);

/**
 * The run's MPM as the renderer performs it, on the renderer's own clock: `slower` times as slow,
 * `louder` velocities louder, the pedal coming up a quarter before the second bar.
 */
export const performed = ({ roll }: DescriptionRun, slower = 1, louder = 0): BroughtOut => ({
    notes: roll.notes.map(({ id, mpm }) => ({
        id,
        ms: mpm.ms * slower,
        msEnd: mpm.msEnd * slower,
        velocity: mpm.velocity + louder,
    })),
    pedal: [
        { ms: 0, value: 127 },
        { ms: msAt(3 * QUARTER) * slower, value: 0 },
    ],
    spared: slower === 1 && louder === 0 ? [] : ['tempo'],
});
