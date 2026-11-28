/**
 * A document run for the describe desk, over the published transcription: that with nothing
 * described the MPM's rendering is a steady tempo and one level laid against the recording, that
 * the calls made by hand run as the Desk runs them, that the steps of a remark are resolved
 * against the recording and against one another, and that what they resolve to, written into the
 * document, is what the Desk's own chain turns into the same instructions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runFit } from '../../../src/fitting/fit';
import {
    describe as runDescription,
    type DescribeRunOptions,
    type DescriptionRun,
} from '../../../src/fitting/description/index';
import type { Call } from '../../../src/model/Work';
import { bar, BAR, left, loadPublished, remark, step, type Published } from './published';

let published: Published;
let choice: Call[];
/** Nothing described: the take chosen, and no more. */
let base: DescriptionRun;

const run = (calls: readonly Call[], options?: DescribeRunOptions) =>
    runDescription(published.alignment, calls, options);

/** The Desk's own run of a document. */
const fit = (calls: Call[]) =>
    runFit({ ...published.work, provenance: calls }, published.alignment.deepClone());

/** The document a run's remarks are written into: what was made by hand, each remark, and what it resolved to. */
const written = (byHand: Call[], remarks: Call[], result: DescriptionRun): Call[] => [
    ...byHand,
    ...result.remarks.flatMap(({ id, concrete }) => {
        const said = remarks.find((call) => call.id === id)!;
        return [
            { ...said, options: { ...said.options, calls: concrete.map((call) => call.id) } },
            ...concrete,
        ];
    }),
];

const tags = (mpm: string, name: string) =>
    [...mpm.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(([tag]) => tag);
const dated = (tag: string) => Number(/ date="([^"]+)"/.exec(tag)?.[1]);

beforeAll(() => {
    published = loadPublished();
    choice = published.choice;
    base = run(choice);
});

describe('with nothing described', () => {
    it('renders a steady tempo and one level, laid against the recording at its two ends', () => {
        const { roll } = base;
        expect(base.problems).toEqual([]);
        expect(base.remarks).toEqual([]);
        expect(roll.assumed.tempo).toHaveLength(1);
        expect(roll.assumed.tempo[0]).toMatchObject({ from: 0, to: roll.end });
        expect(roll.assumed.levelDates).toEqual([0]);
        expect(base.mpm).toContain('<tempo');
        expect(base.mpm).toContain('<dynamics');

        // One row to a note, the take being chosen; the recording runs from its first note, and
        // the rendering begins with it.
        expect(new Set(roll.notes.map((note) => note.id)).size).toBe(roll.notes.length);
        const first = roll.notes.reduce((a, b) => (b.ms < a.ms ? b : a));
        expect(first.ms).toBe(0);
        expect(first.mpm.ms).toBeCloseTo(0, 6);
        // One tempo: every beat as long as the next, and the last chord where it was played.
        const beats = roll.beats.slice(1, -1).map((beat, i) => beat.ms - roll.beats[i]!.ms);
        expect(Math.max(...beats) - Math.min(...beats)).toBeLessThan(1e-6);
        const lastDate = Math.max(...roll.notes.map((note) => note.date));
        const last = roll.notes.filter((note) => note.date === lastDate);
        expect(Math.min(...last.map((note) => Math.abs(note.late)))).toBeLessThan(1);
        // In between the two run apart, which is what there is to describe.
        expect(left(base).pulse).toBeGreaterThan(1000);
        // One level: every note rendered as loud as every other.
        expect(new Set(roll.notes.map((note) => note.mpm.velocity)).size).toBe(1);
        expect(roll.notes.every((note) => note.loud === note.velocity - note.mpm.velocity)).toBe(
            true,
        );
    });

    it('refuses a recording whose readings still stand side by side', () => {
        expect(() => run([])).toThrow(/more than one reading/);
    });
});

describe('the calls made by hand', () => {
    it('leave little of the timing and the loudness, and nothing they describe is assumed', () => {
        const result = run(published.work.provenance);
        const before = left(base);
        const after = left(result);
        // The choice of take, the corrections and the rest: none is refused as not for a reader.
        expect(result.problems).toEqual([]);
        expect(result.remarks).toEqual([]);
        expect(after.pulse).toBeLessThan(before.pulse / 50);
        expect(after.spread).toBeLessThan(before.spread / 3);
        expect(after.loud).toBeLessThan(before.loud);
        expect(result.roll.assumed.levelDates).toEqual([]);
        // The published tempos stop a bar short of the score's end, and only that is assumed.
        expect(result.roll.assumed.tempo.map((gap) => gap.from)).toEqual([91440]);
    });

    it('run untouched: with a tempo for the last bar, the MPM is the one the Desk itself writes', () => {
        const closing: Call = {
            id: 'closing',
            name: 'InsertTempo',
            options: {
                scope: 'global',
                from: 91440,
                to: base.roll.end,
                bpm: 45.518,
                beatLength: 0.25,
            },
        };
        const document = [...published.work.provenance, closing];
        const result = run(document);
        expect(result.roll.assumed.tempo).toEqual([]);
        expect(result.mpm).toBe(fit(document).mpm);
    });

    it('are never handed back as what a remark resolved to', () => {
        const drawn: Call = {
            id: 'drawn',
            name: 'InsertTempo',
            options: { scope: 'global', from: bar(10), to: bar(11), bpm: 200, beatLength: 0.25 },
        };
        const said = remark('r1', [step('FitTempo', { from: bar(1), to: bar(5), step: BAR })]);
        const result = run([...choice, drawn, said]);

        expect(result.mpm).toContain('<tempo date="26640" bpm="200"');
        const handed = result.remarks.flatMap(({ concrete }) => concrete.map((call) => call.id));
        expect(handed).toEqual(['r1.0.0', 'r1.0.1', 'r1.0.2', 'r1.0.3']);
        // Its span counts as described: the tempo assumed on either side stops short of it.
        expect(result.roll.assumed.tempo.map(({ from, to }) => [from, to])).toEqual([
            [0, bar(1)],
            [bar(5), bar(10)],
            [bar(11), result.roll.end],
        ]);
    });

    it('are reported, where one cannot run, as a problem of no step, and the rest still run', () => {
        const result = run([
            ...choice,
            { id: 'unknown', name: 'Nonsense', options: {} },
            {
                id: 'steep',
                name: 'InsertDynamicsGradient',
                options: {
                    scope: 'global',
                    date: 4320,
                    gradient: { from: -2, to: 0 },
                    sortVelocities: true,
                },
            },
            remark('r1', [step('FitDynamics', { from: bar(1), to: bar(2) })]),
        ]);
        expect(result.problems).toHaveLength(2);
        expect(result.problems[0]).toMatch(/no transformer called Nonsense/);
        expect(result.problems[1]).toMatch(/^InsertDynamicsGradient: .*between -1 and 1/);
        expect(result.remarks[0]?.steps[0]?.error).toBeUndefined();
        expect(
            result.roll.notes.every(
                (note) => Number.isFinite(note.mpm.ms) && Number.isFinite(note.loud),
            ),
        ).toBe(true);
    });
});

describe('what a description adds to the chain', () => {
    it('rolls every chord, chord by chord, and gives the ornaments their definitions unasked', () => {
        const result = run([...choice, remark('r1', [step('InsertTemporalSpread')])]);
        const { concrete, steps } = result.remarks[0]!;
        expect(left(result).spread).toBeLessThan(left(base).spread / 3);
        expect(result.mpm).toContain('<ornamentDef');
        expect(result.mpm).not.toContain('neutralArpeggio');
        expect(steps[0]?.evidence.length).toBeGreaterThan(100);
        expect(steps[0]?.definitions.length).toBeGreaterThan(10);

        // As the arpeggiation desk writes them: one call to a chord. The style is only assumed.
        expect(concrete.length).toBeGreaterThan(50);
        expect(concrete.every((call) => call.name === 'InsertTemporalSpread')).toBe(true);
        const dates = concrete.map((call) => call.options['date']);
        expect(dates.every((date) => typeof date === 'number')).toBe(true);
        expect(new Set(dates).size).toBe(dates.length);
        expect(steps[0]?.calls).toEqual(concrete.map((call) => call.id));
    });

    it('writes a roll over every chord as the one call over all of them would have it', () => {
        const over = (name: string, options: Record<string, unknown>): Call => ({
            id: 'over',
            name,
            options: { scope: 'global', ...options },
        });
        // The spread of every chord rolled wider than the threshold, said and made by hand.
        const spread = over('InsertTemporalSpread', {
            placement: 'estimate',
            noteOffShiftTolerance: 2,
            durationThreshold: 35,
        });
        expect(run([...choice, remark('r1', [step('InsertTemporalSpread')])]).mpm).toBe(
            run([...choice, spread]).mpm,
        );

        // The gradient of every chord whose velocities lean, each with the ramp of its direction.
        const [crescendo, decrescendo] = [
            { from: -1, to: 0 },
            { from: 0, to: -1 },
        ];
        const gradient = over('InsertDynamicsGradient', {
            crescendo,
            decrescendo,
            sortVelocities: true,
        });
        const said = run([...choice, remark('r1', [step('InsertDynamicsGradient')])]);
        const { concrete, steps } = said.remarks[0]!;
        expect(steps[0]?.error).toBeUndefined();
        expect(said.mpm).toContain('<dynamicsGradient');
        expect(said.mpm).toBe(run([...choice, gradient]).mpm);
        expect(concrete.length).toBeGreaterThan(50);
        const ramps = concrete.map((call) => call.options['gradient']);
        const rising = ramps.filter((ramp) => JSON.stringify(ramp) === JSON.stringify(crescendo));
        const falling = ramps.filter(
            (ramp) => JSON.stringify(ramp) === JSON.stringify(decrescendo),
        );
        expect(rising.length).toBeGreaterThan(0);
        expect(falling.length).toBeGreaterThan(0);
        expect(rising.length + falling.length).toBe(ramps.length);
    });

    it('rolls the chords of a passage that are rolled, and says so where none is', () => {
        const result = run([
            ...choice,
            remark('r1', [
                step('FitSpread', { from: bar(1), to: bar(3), placement: 'on-beat' }),
                step('FitSpread', { from: bar(1), to: bar(3), durationThreshold: 5000 }),
            ]),
        ]);
        const { concrete, steps } = result.remarks[0]!;
        expect(concrete.length).toBeGreaterThan(1);
        for (const call of concrete) {
            expect(call).toMatchObject({
                name: 'InsertTemporalSpread',
                options: { scope: 'global', placement: 'on-beat', noteOffShiftTolerance: 2 },
            });
            expect(call.options['date']).toBeGreaterThanOrEqual(bar(1));
            expect(call.options['date']).toBeLessThanOrEqual(bar(3));
        }
        expect(steps[0]?.written.every((tag) => tag.startsWith('<ornament'))).toBe(true);
        expect(steps[1]?.error).toMatch(/no chord there is spread wider than 5000 ms/);
    });

    it('reads a tempo off the recording, span by span, and leaves the rest assumed', () => {
        const result = run([
            ...choice,
            remark('r1', [
                step('FitTempo', { from: bar(1), to: bar(9), shape: 'steady', step: BAR / 2 }),
            ]),
        ]);
        const { concrete, steps } = result.remarks[0]!;
        expect(steps[0]?.error).toBeUndefined();
        expect(steps[0]?.fitted.length).toBeGreaterThan(10);
        expect(steps[0]?.written.every((tag) => tag.startsWith('<tempo'))).toBe(true);
        expect(steps[0]?.range).toEqual({ from: bar(1), to: bar(9) });
        expect(left(result, bar(1), bar(9)).pulse).toBeLessThan(
            left(base, bar(1), bar(9)).pulse / 10,
        );
        // What was fitted is handed on as the stated calls a document holds.
        expect(concrete).toHaveLength(steps[0]!.fitted.length);
        expect(
            concrete.every(
                (call) => call.name === 'InsertTempo' && typeof call.options['bpm'] === 'number',
            ),
        ).toBe(true);
        expect(result.roll.assumed.tempo.map((gap) => gap.from)).toEqual([0, bar(9)]);
    });

    it("closes a transition at the score's end on its last chord, and hands over the tempo that follows", () => {
        const { end } = base.roll;
        const said = remark('r1', [
            step('FitTempo', { from: bar(30), to: end, shape: 'transition' }),
        ]);
        const result = run([...choice, said]);
        const { concrete, steps } = result.remarks[0]!;
        const lastDate = Math.max(...result.roll.notes.map((note) => note.date));

        expect(steps[0]?.error).toBeUndefined();
        expect(concrete.map((call) => call.id)).toEqual(['r1.0.0', 'r1.0.0.1']);
        expect(concrete[0]?.options).toMatchObject({ from: bar(30), to: lastDate });
        expect(concrete[1]?.options).toMatchObject({
            from: lastDate,
            to: end,
            bpm: concrete[0]?.options['transitionTo'],
        });
        // Both stand in the Desk's own MPM of the written document.
        const desk = fit(written(choice, [said], result)).mpm;
        expect(tags(desk, 'tempo')).toEqual(
            tags(result.mpm, 'tempo').filter((tag) => dated(tag) >= bar(30)),
        );
    });

    it('lets a later remark own its span, cuts it out of the earlier one, and fits both', () => {
        const [yesterday, today] = ['2026-11-27T12:00:00.000Z', '2026-11-28T12:00:00.000Z'];
        const steady = remark('steady', [step('FitTempo', { from: bar(1), to: bar(9) })], {
            date: yesterday,
        });
        const broadening = remark(
            'broadening',
            [step('FitTempo', { from: bar(6), to: bar(8), shape: 'transition' })],
            {
                date: today,
            },
        );
        const alone = run([...choice, steady]).remarks[0]!;
        // Whichever stands first in the document: the dates say which was made later.
        for (const document of [
            [...choice, steady, broadening],
            [...choice, broadening, steady],
        ]) {
            const result = run(document);
            const earlier = result.remarks.find(({ id }) => id === 'steady')!;
            const later = result.remarks.find(({ id }) => id === 'broadening')!;

            expect(later.steps[0]?.fitted).toHaveLength(1);
            expect(later.steps[0]?.fitted[0]).toMatchObject({ from: bar(6), to: bar(8) });
            expect(later.concrete.map((call) => call.id)).toEqual(['broadening.0.0']);
            // What is left of the earlier span, either side of the cut, each piece read off its own bars.
            expect(
                earlier.concrete.map((call) => [call.id, call.options['from'], call.options['to']]),
            ).toEqual([
                ['steady.0.0', bar(1), bar(6)],
                ['steady.0.0.1', bar(8), bar(9)],
            ]);
            const [before, after] = earlier.steps[0]!.fitted;
            expect(before).toMatchObject({ from: bar(1), to: bar(6) });
            expect(after).toMatchObject({ from: bar(8), to: bar(9) });
            expect(before?.['bpm']).not.toBeCloseTo(alone.steps[0]!.fitted[0]!['bpm'] as number, 3);
            expect(before?.['bpm']).not.toBeCloseTo(after?.['bpm'] as number, 3);
            // Three tempos over the bars, and nothing assumed between them.
            expect(result.roll.assumed.tempo.map((gap) => gap.from)).toEqual([0, bar(9)]);
        }

        // Made the other way round, the transition is the one that gives way: all of it.
        const swapped = run([
            ...choice,
            { ...steady, options: { ...steady.options, date: today } },
            { ...broadening, options: { ...broadening.options, date: yesterday } },
        ]);
        expect(swapped.remarks.map(({ concrete }) => concrete.length)).toEqual([1, 0]);

        // A span cut bar by bar loses the bars that are spoken of anew, and keeps its names.
        const bars = remark('bars', [step('FitTempo', { from: bar(1), to: bar(9), step: BAR })], {
            date: yesterday,
        });
        const cut = run([...choice, bars, broadening]).remarks[0]!;
        expect(cut.steps[0]?.fitted).toHaveLength(6);
        expect(cut.concrete.map((call) => call.id)).toEqual(
            [0, 1, 2, 3, 4, 7].map((part) => `bars.0.${part}`),
        );
    });

    it('takes remarks without a date in the order of the document, before every dated one', () => {
        const whole = step('FitTempo', { from: bar(1), to: bar(5) });
        const half = step('FitTempo', { from: bar(1), to: bar(3) });
        const spans = (...remarks: Call[]) =>
            run([...choice, ...remarks]).remarks.map(({ concrete }) =>
                concrete.map(({ options }) => [options['from'], options['to']]),
            );
        // Neither dated: the one that stands later in the document was made later.
        expect(spans(remark('a', [whole]), remark('b', [half]))).toEqual([
            [[bar(3), bar(5)]],
            [[bar(1), bar(3)]],
        ]);
        expect(spans(remark('b', [half]), remark('a', [whole]))).toEqual([[], [[bar(1), bar(5)]]]);
        // One dated: it was made later, wherever it stands.
        const dated = remark('b', [half], { date: '2026-11-27T12:00:00.000Z' });
        expect(spans(dated, remark('a', [whole]))).toEqual([
            [[bar(1), bar(3)]],
            [[bar(3), bar(5)]],
        ]);
    });

    it('puts a roll on one chord before a roll over all of them, whichever was said first', () => {
        const all = (date: string) => remark('all', [step('InsertTemporalSpread')], { date });
        const one = (date: string) =>
            remark(
                'one',
                [step('InsertTemporalSpread', { date: 1440, placement: 'before-beat' })],
                { date },
            );
        const orders = [
            [all('2026-11-27T12:00:00.000Z'), one('2026-11-28T12:00:00.000Z')],
            [all('2026-11-28T12:00:00.000Z'), one('2026-11-27T12:00:00.000Z')],
        ];
        const rolled = orders.map((remarks) => {
            const result = run([...choice, ...remarks]);
            const [over, single] = result.remarks;
            expect(single?.steps[0]?.elements).toEqual(['ornament_1440']);
            expect(single?.concrete.map((call) => call.options)).toEqual([
                { scope: 'global', date: 1440, placement: 'before-beat', noteOffShiftTolerance: 2 },
            ]);
            expect(over?.steps[0]?.elements).not.toContain('ornament_1440');
            expect(over?.concrete.some((call) => call.options['date'] === 1440)).toBe(false);
            // Measured before anything collapsed it: a frame of some length, not of none.
            expect(result.mpm).not.toMatch(/frameLength="0ticks"/);
            return result.mpm;
        });
        expect(rolled[0]).toBe(rolled[1]);
    });

    it('repeats a call over a passage, passing over a frame with nothing to redistribute', () => {
        const result = run([
            ...choice,
            remark('r1', [
                step('Repeat', {
                    from: bar(9),
                    to: bar(11),
                    step: 720,
                    call: { name: 'InsertRubato', options: { date: '$from', length: '$step' } },
                }),
            ]),
        ]);
        const { concrete, steps } = result.remarks[0]!;
        const tagsWritten = steps[0]?.written ?? [];
        expect(tagsWritten.length).toBeGreaterThan(0);
        expect(tagsWritten.length).toBeLessThan(8);
        expect(tagsWritten.every((tag) => tag.startsWith('<rubato'))).toBe(true);
        // Each named after the stretch it stands on, the idle ones leaving their numbers unused.
        expect(concrete.every((call) => call.name === 'InsertRubato')).toBe(true);
        expect(concrete.map((call) => call.id)).toEqual(
            concrete.map((call) => `r1.0.${((call.options['date'] as number) - bar(9)) / 720}`),
        );
    });

    it('meets a requirement with what it assumes, and hands over nothing the Desk would refuse', () => {
        const accents = step('InsertMetricalAccentuation', {
            from: bar(1),
            to: bar(2),
            beatLength: 0.25,
        });
        const assumed = run([...choice, remark('r1', [accents])]);
        const [alone] = assumed.remarks[0]!.steps;
        expect(alone?.error).toBeUndefined();
        expect(assumed.mpm).toContain('<accentuationPattern');
        // The level it leans on is only assumed, and the Desk's chain asks for one that is stated.
        expect(alone?.withheld).toMatch(/requires InsertDynamics/);
        expect(assumed.remarks[0]?.concrete).toEqual([]);
        expect(() => fit(written(choice, [remark('r1', [accents])], assumed))).not.toThrow();

        // With a level described beside it, it is handed over, and the Desk runs it.
        const said = remark('r1', [accents, step('FitDynamics', { from: bar(1), to: bar(2) })]);
        const stated = run([...choice, said]);
        expect(stated.remarks[0]?.steps.map((report) => report.withheld)).toEqual([
            undefined,
            undefined,
        ]);
        expect(stated.remarks[0]?.concrete.map((call) => call.name)).toEqual([
            'InsertMetricalAccentuation',
            'InsertDynamics',
        ]);
        expect(fit(written(choice, [said], stated)).mpm).toContain('<accentuationPattern');
    });

    it('leaves out a step that cannot run, says why, and runs the rest', () => {
        const result = run([
            ...choice,
            remark('r1', [
                step('InsertTempo', { from: 0, to: 720 }),
                step('InsertDynamics', { scope: 0, from: 0, to: 720 }),
                step('MakeChoice', { prefer: 'x' }),
                step('Nonsense'),
                step('FitDynamics', { from: bar(1), to: bar(2) }),
            ]),
        ]);
        const { concrete, steps } = result.remarks[0]!;
        expect(steps[0]?.error).toMatch(/number for "bpm"/);
        expect(steps[1]?.error).toMatch(/both hands/);
        expect(steps[2]?.error).toMatch(/not a call a description makes/);
        expect(steps[3]?.error).toMatch(/no transformer called Nonsense/);
        expect(steps[4]?.error).toBeUndefined();
        expect(result.problems).toEqual([]);
        expect(concrete.map((call) => call.id)).toEqual(['r1.4.0']);
        expect(
            result.roll.notes.every(
                (note) => Number.isFinite(note.mpm.ms) && Number.isFinite(note.loud),
            ),
        ).toBe(true);
    });

    it('holds the recording still, and moves the rendering to it', () => {
        const tempo = run([
            ...choice,
            remark('r1', [step('FitTempo', { from: bar(1), to: bar(9), step: BAR })]),
        ]);
        const before = new Map(base.roll.notes.map((note) => [note.id, note]));
        // What was played is where it was; what the MPM renders has moved, and nearer.
        expect(tempo.roll.notes.every((note) => note.ms === before.get(note.id)!.ms)).toBe(true);
        expect(
            tempo.roll.notes.some(
                (note) => Math.abs(note.mpm.ms - before.get(note.id)!.mpm.ms) > 100,
            ),
        ).toBe(true);
        expect(left(tempo, bar(1), bar(9)).pulse).toBeLessThan(
            left(base, bar(1), bar(9)).pulse / 5,
        );
        // The beats of the described bars went with it: no longer one as long as the next.
        const beats = tempo.roll.beats
            .slice(1, 30)
            .map((beat, i) => beat.ms - tempo.roll.beats[i]!.ms);
        expect(Math.max(...beats) - Math.min(...beats)).toBeGreaterThan(50);

        // A roll stays as it was played, and it is the rendering that spreads out to meet it.
        const rolled = run([
            ...choice,
            remark('r1', [step('InsertTemporalSpread', { date: 4320 })]),
        ]);
        const chord = (result: DescriptionRun) =>
            result.roll.notes.filter((note) => note.date === 4320);
        const span = (values: number[]) => Math.max(...values) - Math.min(...values);
        expect(span(chord(base).map((note) => note.mpm.ms))).toBeLessThan(1e-6);
        expect(span(chord(rolled).map((note) => note.ms))).toBe(
            span(chord(base).map((note) => note.ms)),
        );
        expect(span(chord(rolled).map((note) => note.mpm.ms))).toBeCloseTo(
            span(chord(base).map((note) => note.ms)),
            0,
        );
    });

    it('corrects the recording where a reader doubts it, and writes no instruction for that', () => {
        const { id, velocity } = base.roll.notes[5]!;
        const result = run([
            ...choice,
            remark('r1', [step('Modify', { aspect: 'velocity', change: -6, noteIDs: [id] })]),
        ]);
        const { concrete, steps } = result.remarks[0]!;
        const corrected = result.roll.notes.find((note) => note.id === id)!;
        expect(steps[0]?.elements).toEqual([]);
        expect(steps[0]?.evidence).toEqual([id]);
        expect(concrete).toEqual([
            {
                id: 'r1.0.0',
                name: 'Modify',
                options: { scope: 'global', aspect: 'velocity', change: -6, noteIDs: [id] },
            },
        ]);
        expect(corrected.velocity).toBe(velocity - 6);
        // What the roll had stays behind it, and no other note has anything behind it.
        expect(corrected.arrived?.velocity).toBe(velocity);
        expect(result.roll.notes.filter((note) => note.arrived)).toHaveLength(1);
    });

    it('reads what a step fits off the recording as corrected, whichever of the two was said first', () => {
        const notes = base.roll.notes.filter((note) => note.date >= bar(1) && note.date <= bar(2));
        const softer = step('Modify', {
            aspect: 'velocity',
            change: -10,
            noteIDs: notes.map((note) => note.id),
        });
        const level = step('FitDynamics', { from: bar(1), to: bar(2) });
        const volume = (steps: ReturnType<typeof step>[]) =>
            run([...choice, remark('r1', steps)]).remarks[0]!.steps.flatMap(
                (report) => report.fitted,
            )[0]!['volume'] as number;
        expect(volume([level, softer])).toBeCloseTo(volume([level]) - 10, 6);
        expect(volume([softer, level])).toBe(volume([level, softer]));
    });

    it("gives the pedals on the roll's clock: the presses as recorded, and the MPM's once it has any", () => {
        const { played } = base.roll.pedals;
        const last = Math.max(...base.roll.notes.map((note) => note.msEnd));
        expect(played.length).toBeGreaterThan(10);
        expect(new Set(played.map((press) => press.kind))).toEqual(new Set(['sustain', 'soft']));
        // On the notes' own clock, in order, each press let go after it was made. The soft pedal goes
        // down before the first note is struck.
        for (const [i, press] of played.entries()) {
            expect(press.msEnd).toBeGreaterThan(press.ms);
            expect(press.ms).toBeGreaterThanOrEqual(i ? played[i - 1]!.ms : -5000);
            expect(press.ms).toBeLessThan(last);
        }
        // Nothing described, nothing rendered; described, the pedal goes down and comes up again.
        expect(base.roll.pedals.mpm).toEqual([]);
        const pedalled = run([...choice, remark('r1', [step('InsertPedal')])]);
        const moves = pedalled.roll.pedals.mpm;
        expect(pedalled.remarks[0]?.steps[0]?.error).toBeUndefined();
        expect(moves.some((move) => move.value >= 64)).toBe(true);
        expect(moves.some((move) => move.value < 64)).toBe(true);
        expect(moves.every((move, i) => i === 0 || move.ms >= moves[i - 1]!.ms)).toBe(true);
    });
});

describe('a remark in the document', () => {
    const [yesterday, today] = ['2026-11-27T12:00:00.000Z', '2026-11-28T12:00:00.000Z'];
    /** Two remarks that meet: a tempo by the bar and a level, then a broadening and a roll said a day later. */
    const remarks = () => [
        remark(
            'r1',
            [
                step('FitTempo', { from: bar(1), to: bar(9), step: BAR / 2 }),
                step('FitDynamics', { from: bar(1), to: bar(5) }),
                step('InsertTemporalSpread'),
            ],
            { date: yesterday },
        ),
        remark(
            'r2',
            [
                step('FitTempo', { from: bar(6), to: bar(8), shape: 'transition' }),
                step('FitDynamics', { from: bar(2), to: bar(3) }),
                step('InsertTemporalSpread', { date: 1440, placement: 'before-beat' }),
            ],
            { date: today },
        ),
    ];

    it('passes over the calls a remark owns, and makes them again from its steps', () => {
        const steps = [step('FitTempo', { from: bar(1), to: bar(5), step: BAR })];
        const tempo = (id: string, from: number, bpm: number): Call => ({
            id,
            name: 'InsertTempo',
            options: { scope: 'global', from, to: from + BAR, bpm, beatLength: 0.25 },
        });
        // What the steps resolved to once, by now out of date, and a call the remark has since lost.
        const owned = [tempo('r1.0.0', bar(1), 10), tempo('stale', bar(10), 200)];
        const fresh = run([...choice, remark('r1', steps)]);
        const again = run([
            ...choice,
            ...owned,
            remark('r1', steps, { calls: ['r1.0.0', 'stale'] }),
        ]);

        expect(again.mpm).toBe(fresh.mpm);
        expect(again.remarks).toEqual(fresh.remarks);
        expect(again.mpm).not.toContain('bpm="200"');
        // The same call owned by no remark is a call made by hand, and runs.
        expect(
            run([...choice, ...owned, remark('r1', steps, { calls: ['r1.0.0'] })]).mpm,
        ).toContain('bpm="200"');
    });

    it('names the calls after the remark, the step and their place in it, the same from run to run', () => {
        const document = [...choice, ...remarks()];
        const first = run(document);
        const second = run(document);
        const ids = first.remarks.flatMap(({ concrete }) => concrete.map((call) => call.id));

        expect(first.remarks.flatMap(({ steps }) => steps.map((report) => report.error))).toEqual(
            Array(6).fill(undefined),
        );
        expect(ids.length).toBeGreaterThan(60);
        expect(new Set(ids).size).toBe(ids.length);
        expect(second.remarks.flatMap(({ concrete }) => concrete.map((call) => call.id))).toEqual(
            ids,
        );
        expect(second).toEqual(first);
        for (const { id, concrete, steps } of first.remarks) {
            // Every call under its step, the steps in their order.
            expect(steps.flatMap((report) => report.calls)).toEqual(
                concrete.map((call) => call.id),
            );
            steps.forEach((report, at) => {
                expect(
                    report.calls.every((call) =>
                        new RegExp(`^${id}\\.${at}\\.\\d+(\\.\\d+)?$`).test(call),
                    ),
                ).toBe(true);
            });
        }
        // Written into the document, they are passed over and made again alike.
        expect(run(written(choice, remarks(), first)).remarks).toEqual(first.remarks);
    });

    it("hands over calls the Desk's own chain turns into the same instructions, less what was assumed", () => {
        const byHand = [
            ...choice,
            ...published.work.provenance.filter(
                (call) =>
                    ['InsertTempo', 'InsertDynamics'].includes(call.name) &&
                    (call.options['from'] as number) >= bar(17),
            ),
        ];
        const result = run([...byHand, ...remarks()]);
        const document = written(byHand, remarks(), result);
        const desk = fit(document).mpm;
        const { assumed } = result.roll;
        expect(assumed.tempo.length).toBeGreaterThan(1);
        expect(assumed.levelDates.length).toBeGreaterThan(1);

        // Every tempo inside a span some call of the document states is the Desk's too, and the
        // other way round; what else the run has, it assumed.
        const spans = document
            .filter((call) => call.name === 'InsertTempo')
            .map(({ options }) => options);
        const described = (tag: string) =>
            spans.some(
                ({ from, to }) => dated(tag) >= (from as number) && dated(tag) < (to as number),
            );
        expect(tags(result.mpm, 'tempo').filter(described)).toEqual(
            tags(desk, 'tempo').filter(described),
        );
        expect(tags(result.mpm, 'tempo').filter(described).length).toBeGreaterThan(30);
        const gaps = assumed.tempo.flatMap((gap) => [gap.from, gap.to]);
        expect(
            tags(result.mpm, 'tempo')
                .filter((tag) => !described(tag))
                .every((tag) => gaps.includes(dated(tag))),
        ).toBe(true);

        // And every level but the one assumed.
        expect(
            tags(result.mpm, 'dynamics').filter((tag) => !assumed.levelDates.includes(dated(tag))),
        ).toEqual(tags(desk, 'dynamics'));
        expect(tags(desk, 'dynamics').length).toBeGreaterThan(20);
    });

    it("comes to the Desk's own MPM, to the letter, where nothing is left to assume", () => {
        const { end } = base.roll;
        const byHand = [
            ...choice,
            ...published.work.provenance.filter(
                (call) =>
                    call.name === 'Modify' ||
                    (call.name === 'InsertTempo' && (call.options['from'] as number) >= bar(17)),
            ),
            {
                id: 'closing',
                name: 'InsertTempo',
                options: { scope: 'global', from: 91440, to: end, bpm: 45.518, beatLength: 0.25 },
            },
        ];
        const third = [
            ...new Set(
                base.roll.notes
                    .filter((note) => note.date >= bar(3) && note.date < bar(4))
                    .map((note) => note.id),
            ),
        ];
        const said = [
            remark(
                'r2',
                [
                    step('FitTempo', { from: bar(6), to: bar(8), shape: 'transition' }),
                    step('InsertTemporalSpread', { date: 1440, placement: 'before-beat' }),
                    step('FitDynamics', { from: bar(2), to: bar(3) }),
                ],
                { date: today },
            ),
            remark(
                'r1',
                [
                    step('FitTempo', { from: 0, to: bar(17), step: BAR / 2 }),
                    step('Repeat', {
                        from: 0,
                        to: 92160,
                        step: BAR,
                        call: { name: 'FitDynamics', options: { from: '$from', to: '$to' } },
                    }),
                    step('InsertTemporalSpread'),
                    step('InsertDynamicsGradient'),
                    step('StylizeOrnamentation'),
                    step('Repeat', {
                        from: bar(9),
                        to: bar(11),
                        step: 720,
                        call: { name: 'InsertRubato', options: { date: '$from', length: '$step' } },
                    }),
                    step('InsertMetricalAccentuation', {
                        from: bar(1),
                        to: bar(3),
                        beatLength: 0.25,
                    }),
                    step('Modify', { aspect: 'velocity', change: -6, noteIDs: [third[0]] }),
                    step('InsertArticulation', { noteIDs: third }),
                    step('InsertPedal'),
                ],
                { date: yesterday },
            ),
        ];
        const result = run([...byHand, ...said]);
        const reports = result.remarks.flatMap(({ steps }) => steps);
        expect(reports.map((report) => report.error ?? report.withheld)).toEqual(
            Array(reports.length).fill(undefined),
        );
        expect(result.problems).toEqual([]);
        expect(result.roll.assumed).toMatchObject({ tempo: [], levelDates: [] });
        expect(result.mpm).toContain('<ornamentDef');

        expect(fit(written(byHand, said, result)).mpm).toBe(result.mpm);
    });

    it("tries steps in a remark's place for one run, and leaves the next run as it was", () => {
        const document = [...choice, ...remarks()];
        const plain = run(document);

        // In place of a remark the document holds: its steps for this run are the ones tried.
        const tried = run(document, {
            trial: {
                remark: 'r2',
                steps: [step('FitTempo', { from: bar(2), to: bar(4), shape: 'transition' })],
            },
        });
        expect(tried.remarks.map(({ id }) => id)).toEqual(['r1', 'r2']);
        expect(tried.remarks[1]?.steps).toHaveLength(1);
        expect(tried.remarks[1]?.steps[0]?.fitted[0]).toMatchObject({ from: bar(2), to: bar(4) });
        expect(tried.mpm).not.toBe(plain.mpm);

        // A remark it does not hold is a new one, made last: it owns its bars over both.
        const added = run(document, {
            trial: {
                remark: 'r3',
                steps: [step('FitTempo', { from: bar(7), to: bar(9), shape: 'transition' })],
            },
        });
        expect(added.remarks.map(({ id }) => id)).toEqual(['r1', 'r2', 'r3']);
        expect(
            added.remarks[2]?.concrete.map(({ id, options }) => [
                id,
                options['from'],
                options['to'],
            ]),
        ).toEqual([['r3.0.0', bar(7), bar(9)]]);
        expect(added.remarks[1]?.concrete[0]?.options).toMatchObject({ from: bar(6), to: bar(7) });

        expect(run(document)).toEqual(plain);
    });

    it('reads a remark saved without steps as one that became nothing', () => {
        const { steps: _steps, ...saved } = remark('r1', []).options;
        void _steps;
        const result = run([...choice, { id: 'r1', name: 'Describe', options: saved }]);
        expect(result.remarks).toEqual([{ id: 'r1', concrete: [], steps: [] }]);
        expect(result.mpm).toBe(base.mpm);
    });

    it("takes steps as they were written down: guides as pairs, as an object, or in the file's envelope", () => {
        const guided = (guides: unknown) =>
            run([
                ...choice,
                remark('r1', [step('InsertDynamics', { from: bar(1), to: bar(2), guides })]),
            ]).remarks[0]!;
        const pairs = guided([[bar(1), 40]]);
        expect(pairs.steps[0]?.error).toBeUndefined();
        expect(pairs.concrete[0]?.options['guides']).toEqual(new Map([[bar(1), 40]]));
        expect(guided({ [bar(1)]: 40 })).toEqual(pairs);
        expect(guided({ dataType: 'Map', value: [[bar(1), 40]] })).toEqual(pairs);
        expect(guided(new Map([[bar(1), 40]]))).toEqual(pairs);
    });
});
