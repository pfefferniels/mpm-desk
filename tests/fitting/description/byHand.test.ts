/**
 * A remark and the calls made by hand, over the published reconstruction: every bar of it has
 * its tempo, its dynamics, its rolls and its pedal from another desk already. On trial a remark
 * takes the place of what stands there, and says what; written with those calls kept, it stands
 * behind them. Either way nothing is handed over that writes an id twice, or writes nothing, and
 * the document as written is the one the Desk's own chain makes the same MPM of.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runFit } from '../../../src/fitting/fit';
import {
    describe as runDescription,
    type DescribeRunOptions,
    type DescriptionRun,
} from '../../../src/fitting/description/index';
import type { Call } from '../../../src/model/Work';
import { EMPTY_WORK, workReducer } from '../../../src/model/workReducer';
import { bar, left, loadPublished, remark, step, type Published } from './published';

/** Bars 16 and 17: five tempos, four dynamics spans, six rolls and four presses made by hand. */
const [FROM, TO] = [bar(16), bar(18)];
const PRESSES = ['sustain-43920', 'sustain-45000', 'sustain-45720', 'sustain-47520'];
const TODAY = '2026-11-28T12:00:00.000Z';

let published: Published;
/** The published reconstruction, with a tempo for its last bar: nothing in it is left to assume. */
let document: Call[];
/** The document as it stands, before anything is said of it. */
let before: DescriptionRun;

const run = (calls: readonly Call[], options?: DescribeRunOptions) =>
    runDescription(published.alignment, calls, options);
const fit = (calls: Call[]) =>
    runFit({ ...published.work, provenance: calls }, published.alignment.deepClone()).mpm;

/**
 * The one edit that writes a run into a document, as `run.ts` gives it: what the remark on trial
 * displaces out and what is left of it in, then every remark with what it resolved to.
 */
const write = (calls: Call[], remarks: Call[], result: DescriptionRun): Call[] => {
    const displaced = result.remarks.flatMap((report) => report.displaced ?? []);
    const owned = calls
        .filter((call) => call.name === 'Describe')
        .flatMap((call) => [call.id, ...(call.options['calls'] as string[])]);
    return workReducer(
        { ...EMPTY_WORK, provenance: calls },
        {
            type: 'replace-calls',
            remove: [...displaced.map(({ call }) => call.id), ...owned],
            add: [
                ...displaced.flatMap(({ left: remainders }) => remainders),
                ...result.remarks.flatMap(({ id, concrete }) => {
                    const said = remarks.find((call) => call.id === id)!;
                    const calls = concrete.map((call) => call.id);
                    return [{ ...said, options: { ...said.options, calls } }, ...concrete];
                }),
            ],
        },
    ).provenance;
};

const tags = (mpm: string, name: string, from = FROM, to = TO - 1) =>
    [...mpm.matchAll(new RegExp(`<${name}\\b[^>]*\\sdate="([^"]+)"[^>]*>`, 'g'))]
        .filter(([, date]) => Number(date) >= from && Number(date) <= to)
        .map(([tag]) => tag);
/** The `xml:id`s more than one element of an MPM goes by. */
const twice = (mpm: string) => {
    const ids = [...mpm.matchAll(/xml:id="([^"]+)"/g)].map(([, id]) => id);
    return [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))];
};
const byHandIn = (name: string, within: (call: Call) => boolean) =>
    document.filter((call) => call.name === name && within(call)).map((call) => call.id);
const starting = ({ options }: Call) =>
    (options['from'] as number) >= FROM && (options['from'] as number) < TO;

beforeAll(() => {
    published = loadPublished();
    const end = Math.max(...published.alignment.allNotes.map((note) => note.date + note.duration));
    document = [
        ...published.work.provenance,
        {
            id: 'closing',
            name: 'InsertTempo',
            options: { scope: 'global', from: 91440, to: end, bpm: 45.518, beatLength: 0.25 },
        },
    ];
    before = run(document);
}, 120_000);

describe('a remark over bars that are described by hand', () => {
    /** A broadening, one level, a roll on the first chord and the four presses traced. */
    const steps = [
        step('FitTempo', { from: FROM, to: TO, shape: 'transition' }),
        step('FitDynamics', { from: FROM, to: TO }),
        step('InsertTemporalSpread', { date: FROM, placement: 'on-beat' }),
        ...PRESSES.map((pedal) => step('InsertPedal', { pedal })),
    ];
    const said = remark('said', steps, { date: TODAY });

    let trial: DescriptionRun;
    let replaced: Call[];
    let after: DescriptionRun;
    let kept: DescriptionRun;

    beforeAll(() => {
        trial = run(document, { trial: { remark: 'said', steps } });
        replaced = write(document, [said], trial);
        after = run(replaced);
        kept = run([...document, said]);
    }, 240_000);

    it('on trial takes the place of what stands there, and says what goes and what is left', () => {
        const tried = trial.remarks.at(-1)!;
        expect(trial.problems).toEqual([]);
        expect(
            tried.steps.map(({ error, withheld, behind }) => error ?? withheld ?? behind),
        ).toEqual(Array(steps.length).fill(undefined));
        expect(tried.steps.every((report) => report.gaveWayTo === undefined)).toBe(true);

        // Five tempos start in the two bars, and all of them go.
        const [tempo, dynamics, roll, ...pedals] = tried.steps;
        expect(tempo?.displaces).toEqual(byHandIn('InsertTempo', starting));
        expect(tempo?.displaces).toHaveLength(5);
        // Of the four dynamics spans the two inside go; the one reaching in ends on the chord
        // before the bars, the one reaching out begins on the chord after them.
        const chords = [...new Set(before.roll.notes.map((note) => note.date))].sort(
            (a, b) => a - b,
        );
        const whatIsLeft = (id: string) =>
            tried.displaced!.find(({ call }) => call.id === id)!.left;
        expect(dynamics?.displaces).toHaveLength(4);
        const spans = dynamics!.displaces!.map((id) => {
            const { from, to } = document.find((call) => call.id === id)!.options;
            return [
                from,
                to,
                whatIsLeft(id).map(({ options }) => [options['from'], options['to']]),
            ];
        });
        expect(spans).toEqual([
            [46800, 48960, []],
            [48960, 49320, []],
            [49320, 50400, [[chords.find((date) => date > TO), 50400]]],
            [42480, 46800, [[42480, chords.findLast((date) => date < FROM)]]],
        ]);
        // The roll made by hand on that chord, and the line drawn by hand for each press.
        expect(roll?.displaces).toEqual(
            byHandIn('InsertTemporalSpread', ({ options }) => options['date'] === FROM),
        );
        expect(pedals.map((report) => report.displaces)).toEqual(
            PRESSES.map((pedal) =>
                byHandIn('InsertPedal', ({ options }) => options['pedal'] === pedal),
            ),
        );

        // Every one of them is in `displaced` once, as the document holds it; what is left of a
        // call goes by its id.
        const displaced = tried.displaced!;
        expect(displaced.map(({ call }) => call.id).sort()).toEqual(
            tried.steps.flatMap((report) => report.displaces!).sort(),
        );
        expect(displaced.every(({ call }) => document.includes(call))).toBe(true);
        expect(
            displaced.flatMap(({ call, left: rest }) => rest.map(({ id }) => id === call.id)),
        ).toEqual([true, true]);
        expect(trial.remarks.slice(0, -1).every((report) => report.displaced === undefined)).toBe(
            true,
        );
    });

    it('on trial comes out clean: one tempo, one level, the chord rolled, each press once', () => {
        const [tempo, dynamics, roll, ...pedals] = trial.remarks.at(-1)!.steps;
        // What each step is credited with is what stands in the bars, and all that stands there.
        expect(tempo?.elements).toEqual([`tempo_${FROM}`]);
        expect(tags(trial.mpm, 'tempo')).toEqual(tempo?.written);
        expect(dynamics?.elements).toEqual([`dynamics_${FROM}`]);
        expect(tags(trial.mpm, 'dynamics', FROM, TO)).toEqual(dynamics?.written);
        expect(Number(/volume="([\d.]+)"/.exec(dynamics!.written[0]!)?.[1])).toBeCloseTo(26.36, 1);

        // The chord is rolled on the beat over what was played, not left with a frame of nothing.
        const definition = roll?.definitions[0] ?? '';
        expect(roll?.elements).toEqual([`ornament_${FROM}`]);
        expect(definition).toMatch(/frame\.offset="0ticks"/);
        expect(Number(/frameLength="([\d.]+)ticks"/.exec(definition)?.[1])).toBeGreaterThan(100);
        expect(left(trial, FROM, TO).spread).toBeLessThan(10);

        // A press is the remark's alone: down and up again, and no id is given twice.
        expect(pedals.map((report) => report.elements)).toEqual(
            PRESSES.map((pedal) => [`${pedal}_down`, `${pedal}_rest`]),
        );
        expect(twice(trial.mpm)).toEqual([]);
        expect(twice(before.mpm)).toEqual([]);
        // Every call handed over wrote something that stands.
        const steps = trial.remarks.at(-1)!.steps;
        expect(steps.every((report) => report.calls.length > 0)).toBe(true);
        expect(steps.flatMap((report) => report.written).every((tag) => tag !== '')).toBe(true);
        // One curve for two bars is coarser than the five it replaces, and one level than four
        // curves: that is what was said, and the trial shows it.
        expect(left(before, FROM, TO).pulse).toBeLessThan(60);
        expect(left(trial, FROM, TO).pulse).toBeGreaterThan(left(before, FROM, TO).pulse);
        expect(left(trial, FROM, TO).loud).toBeGreaterThan(left(before, FROM, TO).loud);
    });

    it('is written in one edit, after which a plain run and the Desk itself agree with the trial', () => {
        const tried = trial.remarks.at(-1)!;
        // Out: the fourteen calls displaced. In: two remainders, the remark and its seven calls.
        expect(tried.displaced).toHaveLength(14);
        expect(replaced).toHaveLength(document.length - 14 + 2 + 1 + tried.concrete.length);
        expect(tried.concrete).toHaveLength(7);

        const written = after.remarks[0]!;
        expect(written.concrete).toEqual(tried.concrete);
        expect(written.displaced).toBeUndefined();
        expect(written.steps.map(({ gaveWayTo, behind }) => gaveWayTo ?? behind)).toEqual(
            Array(steps.length).fill(undefined),
        );
        expect(after.mpm).toBe(trial.mpm);
        expect(after.roll.assumed).toMatchObject({ tempo: [], levelDates: [] });
        expect(fit(replaced)).toBe(trial.mpm);

        // Written again from the plain run, the document does not change: nothing more to undo.
        expect(write(replaced, [said], after)).toBe(replaced);
    });

    it('written with the calls made by hand kept, stands behind them and changes nothing', () => {
        const report = kept.remarks[0]!;
        expect(kept.problems).toEqual([]);
        expect(report.concrete).toEqual([]);
        expect(report.displaced).toBeUndefined();
        expect(kept.mpm).toBe(before.mpm);

        // No step is in error: each says what it stands behind, and names the calls.
        const [tempo, dynamics, roll, ...pedals] = report.steps;
        expect(report.steps.every(({ error, withheld }) => !error && !withheld)).toBe(true);
        expect(tempo?.behind).toMatch(/stands behind .*made by hand.*InsertTempo ×4/);
        expect(byHandIn('InsertTempo', starting)).toEqual(
            expect.arrayContaining(tempo!.gaveWayTo!),
        );
        expect(dynamics?.behind).toMatch(/InsertDynamics ×4/);
        expect(roll?.behind).toMatch(/InsertTemporalSpread ×1/);
        expect(roll?.gaveWayTo).toEqual(
            byHandIn('InsertTemporalSpread', ({ options }) => options['date'] === FROM),
        );
        expect(pedals.map((one) => one.gaveWayTo)).toEqual(
            PRESSES.map((pedal) =>
                byHandIn('InsertPedal', ({ options }) => options['pedal'] === pedal),
            ),
        );
        expect(
            report.steps.every((one) => one.calls.length === 0 && one.elements.length === 0),
        ).toBe(true);
    });
});

describe('what is left of a call made by hand', () => {
    it("keeps a drawn tempo's line either side of the cut, and a level where a hand's stood", () => {
        // The tempo cuts into a hand-drawn transition at either end; the level begins on the very
        // date a hand-made `<dynamics>` stands on; the gradient is said of a chord a hand-made
        // call over every chord describes already.
        const steps = [
            step('FitTempo', { from: 44640, to: 47520 }),
            step('FitDynamics', { from: 46800, to: TO }),
            step('InsertDynamicsGradient', { date: FROM }),
        ];
        const trial = run(document, { trial: { remark: 'said', steps } });
        const [tempo, dynamics, gradient] = trial.remarks.at(-1)!.steps;
        const whatIsLeft = (from: number) =>
            trial.remarks
                .at(-1)!
                .displaced!.filter(
                    ({ call }) => call.name === 'InsertTempo' && call.options['from'] === from,
                )
                .map(({ call, left: rest }) => ({
                    was: call.options,
                    left: rest.map(({ options }) => options),
                }));

        // Up to the cut the line is the one that was drawn: it arrives at the tempo it had there.
        for (const { was, left: rest } of whatIsLeft(FROM)) {
            expect(rest).toHaveLength(1);
            expect(rest[0]).toMatchObject({
                from: FROM,
                to: 44640,
                bpm: was['bpm'],
                meanTempoAt: was['meanTempoAt'],
            });
            const [start, end, there] = [
                was['bpm'],
                was['transitionTo'],
                rest[0]!['transitionTo'],
            ] as number[];
            expect(there).toBeGreaterThan(Math.min(start!, end!));
            expect(there).toBeLessThan(Math.max(start!, end!));
        }
        // From the cut on it starts at the tempo it had there and arrives where it was going.
        const [{ was, left: rest }] = whatIsLeft(46800);
        expect(rest).toHaveLength(1);
        expect(rest[0]).toMatchObject({
            from: 47520,
            to: was['to'],
            transitionTo: was['transitionTo'],
        });
        expect(rest[0]!['bpm']).toBeLessThan(was['bpm'] as number);
        expect(rest[0]!['bpm']).toBeGreaterThan(was['transitionTo'] as number);
        // The one that lay inside is gone.
        expect(whatIsLeft(45360)).toEqual([{ was: expect.anything(), left: [] }]);
        expect(tempo?.displaces).toHaveLength(4);

        // So the beats before the remark's tempo fall where they fell. After it the hand-drawn
        // line begins on a chord, and is laid against the recording there: from that chord on the
        // beats are as far apart as they were, to a few ms, and past the next such chord they
        // fall where they fell again.
        const beats = (result: DescriptionRun) =>
            new Map(result.roll.beats.map((beat) => [beat.date, beat.ms]));
        const [fell, fall] = [beats(before), beats(trial)];
        const moved = (from: number, to: number, since?: number) => {
            const lead = since === undefined ? 0 : fall.get(since)! - fell.get(since)!;
            const dates = [...fall.keys()].filter((date) => date >= from && date < to);
            return Math.max(
                ...dates.map((date) => Math.abs(fall.get(date)! - fell.get(date)! - lead)),
            );
        };
        expect(moved(0, 44640)).toBeLessThan(0.05);
        expect(moved(44640, 47520)).toBeGreaterThan(20);
        expect(moved(47520, 49680, 47520)).toBeLessThan(5);
        expect(moved(49680, 90000)).toBeLessThan(0.05);

        // The level is written, on a date cleared for it: the span that ended there ends a chord
        // earlier, and its last instruction with it.
        expect(dynamics?.elements).toEqual(['dynamics_46800']);
        expect(dynamics?.written[0]).toMatch(/<dynamics date="46800" volume="31\.63/);
        expect(dynamics?.calls).toEqual(['said.1.0']);
        const ended = trial.remarks
            .at(-1)!
            .displaced!.find(
                ({ call }) => call.name === 'InsertDynamics' && call.options['to'] === 46800,
            )!;
        expect(ended.left.map(({ options }) => options['to'])).toEqual([46440]);

        // What is said by hand of every chord is not undone for one: there the remark stands
        // behind it on trial too, and displaces nothing.
        expect(gradient?.behind).toMatch(/InsertDynamicsGradient ×1/);
        expect(gradient?.displaces).toBeUndefined();
        expect(gradient?.calls).toEqual([]);

        expect(trial.problems).toEqual([]);
        expect(twice(trial.mpm)).toEqual([]);
        expect(fit(write(document, [remark('said', steps, { date: TODAY })], trial))).toBe(
            trial.mpm,
        );
    }, 120_000);

    it("goes by the call's id, and by the next id free where a call is left in two", () => {
        // A level for bars 3 and 4, in the middle of dynamics drawn by hand over bars 1 to 6.
        const drawn: Call = {
            id: 'drawn',
            name: 'InsertDynamics',
            options: { scope: 'global', from: bar(1), to: bar(7), guides: new Map() },
        };
        const calls = [...published.choice, drawn];
        const level = [step('FitDynamics', { from: bar(3), to: bar(5) })];
        const trial = run(calls, { trial: { remark: 'r1', steps: level } });
        const { displaced } = trial.remarks[0]!;
        expect(displaced).toHaveLength(1);
        expect(displaced![0]?.call).toBe(drawn);
        const [first, second] = displaced![0]!.left;
        expect([first?.id, second?.id]).toEqual(['drawn', 'drawn.1']);
        expect(first?.options).toMatchObject({ from: bar(1) });
        expect(first?.options['to']).toBeLessThan(bar(3));
        expect(second?.options).toMatchObject({ to: bar(7) });
        expect(second?.options['from']).toBeGreaterThan(bar(5));
        // Run again, the same trial names them alike.
        expect(run(calls, { trial: { remark: 'r1', steps: level } }).remarks[0]?.displaced).toEqual(
            displaced,
        );

        // Written, and cut again by a second remark: the id taken is passed over.
        const said = remark('r1', level, { date: '2026-11-27T12:00:00.000Z' });
        const once = write(calls, [said], trial);
        expect(once.map(({ id }) => id)).toEqual([
            ...published.choice.map(({ id }) => id),
            'drawn',
            'drawn.1',
            'r1',
            'r1.0.0',
        ]);
        const again = run(once, {
            trial: {
                remark: 'r2',
                steps: [step('FitDynamics', { from: bar(1) + 720, to: bar(2) })],
            },
        });
        expect(
            again.remarks
                .at(-1)
                ?.displaced?.map(({ call, left: rest }) => [call.id, rest.map(({ id }) => id)]),
        ).toEqual([['drawn', ['drawn', 'drawn.2']]]);
        expect(again.remarks[0]?.displaced).toBeUndefined();

        // The Desk's own chain states the same dynamics for the document as written, less the
        // level the run assumed where nothing is described.
        const plain = run(once);
        const dynamics = (mpm: string) => tags(mpm, 'dynamics', 0, Infinity);
        const assumed = plain.roll.assumed.levelDates.map((date) => `date="${date}"`);
        expect(plain.remarks[0]?.concrete).toEqual(trial.remarks[0]?.concrete);
        expect(
            dynamics(plain.mpm).filter((tag) => !assumed.some((date) => tag.includes(date))),
        ).toEqual(dynamics(fit(once)));
    });
});

describe('a written remark and a call made by hand since', () => {
    it('is cut round it, each piece fitted to what it has left, and says what it gave way to', () => {
        const drawn: Call = {
            id: 'drawn',
            name: 'InsertTempo',
            options: { scope: 'global', from: bar(3), to: bar(4), bpm: 50, beatLength: 0.25 },
        };
        const said = remark('r1', [step('FitTempo', { from: bar(1), to: bar(6) })], {
            date: TODAY,
        });
        const alone = run([...published.choice, said]).remarks[0]!;
        const result = run([...published.choice, said, drawn]);
        const { concrete, steps, displaced } = result.remarks[0]!;

        expect(alone.concrete.map((call) => call.id)).toEqual(['r1.0.0']);
        expect(concrete.map(({ id, options }) => [id, options['from'], options['to']])).toEqual([
            ['r1.0.0', bar(1), bar(3)],
            ['r1.0.0.1', bar(4), bar(6)],
        ]);
        expect(steps[0]).toMatchObject({ gaveWayTo: ['drawn'], calls: ['r1.0.0', 'r1.0.0.1'] });
        expect(steps[0]?.behind).toBeUndefined();
        expect(displaced).toBeUndefined();
        expect(result.mpm).toContain(`<tempo date="${bar(3)}" bpm="50"`);
        expect(steps[0]?.fitted.map((line) => line['bpm'])).not.toContain(
            alone.steps[0]?.fitted[0]?.['bpm'],
        );

        // The same remark on trial takes the drawn tempo's place instead.
        const trial = run([...published.choice, drawn], {
            trial: { remark: 'r1', steps: [step('FitTempo', { from: bar(1), to: bar(6) })] },
        });
        expect(trial.remarks[0]?.displaced).toEqual([{ call: drawn, left: [] }]);
        expect(trial.remarks[0]?.concrete).toEqual(alone.concrete);
    });

    it('leaves to the hand the presses the hand describes, and traces the rest', () => {
        const press = (pedal: string): Call => ({
            id: `drawn-${pedal}`,
            name: 'InsertPedal',
            options: { pedal },
        });
        const base = run(published.choice);
        const [first, second] = base.roll.pedals.played.map(({ id }) => id);
        const calls = [...published.choice, press(first!), press(second!)];
        const every = [step('InsertPedal')];
        const kept = run([...calls, remark('r1', every)]);
        const { concrete, steps } = kept.remarks[0]!;

        expect([...steps[0]!.gaveWayTo!].sort()).toEqual(
            [`drawn-${first}`, `drawn-${second}`].sort(),
        );
        expect(steps[0]?.behind).toBeUndefined();
        expect(concrete.length).toBeGreaterThan(10);
        expect(concrete.map((call) => call.options['pedal'])).not.toContain(first);
        expect(twice(kept.mpm)).toEqual([]);
        // With nothing made by hand it is the line one call over every press writes.
        const all = run([...published.choice, remark('r1', every)]);
        expect(all.mpm).toBe(
            run([...published.choice, { id: 'every', name: 'InsertPedal', options: {} }]).mpm,
        );
        expect(kept.mpm).toBe(all.mpm);

        // On trial it takes both presses over; a call made by hand over every press it leaves be.
        const trial = run(calls, { trial: { remark: 'r1', steps: every } });
        expect(trial.remarks[0]?.displaced).toEqual(
            calls.slice(-2).map((call) => ({ call, left: [] })),
        );
        const under = run(
            [...published.choice, { id: 'every', name: 'InsertPedal', options: {} }],
            {
                trial: { remark: 'r1', steps: every },
            },
        );
        expect(under.remarks[0]).toMatchObject({ concrete: [] });
        expect(under.remarks[0]?.displaced).toBeUndefined();
        expect(under.remarks[0]?.steps[0]?.behind).toMatch(/InsertPedal ×1/);
        expect(twice(under.mpm)).toEqual([]);
    });
});

describe('what is never handed over', () => {
    it('is a call that wrote nothing, its place being spoken for on the very date', () => {
        // A level stated by hand on one date, which takes no place, and a remark's level from it on.
        const stated: Call = {
            id: 'stated',
            name: 'InsertDynamics',
            options: { scope: 'global', from: bar(2), to: bar(2), guides: new Map([[bar(2), 50]]) },
        };
        const level = [step('FitDynamics', { from: bar(2), to: bar(4) })];
        const said = remark('r1', level);
        const result = run([...published.choice, stated, said]);
        const [report] = result.remarks[0]!.steps;

        expect(result.mpm).toContain(`<dynamics date="${bar(2)}" volume="50"`);
        expect(report?.error).toBeUndefined();
        expect(report?.withheld).toMatch(/FitDynamics wrote nothing/);
        expect(report?.elements).toEqual([]);
        expect(result.remarks[0]?.concrete).toEqual([]);
        // On trial it takes the date over, and writes.
        const trial = run([...published.choice, stated], { trial: { remark: 'r1', steps: level } });
        expect(trial.remarks[0]?.displaced).toEqual([{ call: stated, left: [] }]);
        expect(trial.remarks[0]?.steps[0]?.elements).toEqual([`dynamics_${bar(2)}`]);
        expect(trial.remarks[0]?.steps[0]?.withheld).toBeUndefined();
    });

    it('is the place of a call made by hand, to a call on trial that then comes to nothing', () => {
        const drawn: Call = {
            id: 'drawn',
            name: 'InsertTempo',
            options: { scope: 'global', from: bar(3), to: bar(4), bpm: 50, beatLength: 0.25 },
        };
        const calls = [...published.choice, drawn];
        // No chord sounds in the ten ticks it speaks of, so there is no tempo to read off: the
        // drawn tempo it would have cut in two is left whole, and nothing is offered to replace.
        const nothing = [step('FitTempo', { from: bar(3) + 10, to: bar(3) + 20 })];
        const trial = run(calls, { trial: { remark: 'r1', steps: nothing } });
        const [report] = trial.remarks[0]!.steps;

        expect(report?.error).toMatch(/no chord sounds/);
        expect(report?.displaces).toBeUndefined();
        expect(trial.remarks[0]?.displaced).toBeUndefined();
        expect(trial.remarks[0]?.concrete).toEqual([]);
        expect(trial.mpm).toBe(run(calls).mpm);
        // With a chord to read it off, the same step does cut the drawn tempo in two.
        const fitted = [step('FitTempo', { from: bar(3) + 10, to: bar(3) + 1440 })];
        const taken = run(calls, { trial: { remark: 'r1', steps: fitted } }).remarks[0]!;
        expect(taken.steps[0]?.error).toBeUndefined();
        expect(taken.displaced?.map(({ left: rest }) => rest.map(({ id }) => id))).toEqual([
            ['drawn', 'drawn.1'],
        ]);
    });

    it('is an id written twice: where two calls made by hand come to that, the run says so', () => {
        const [press] = run(published.choice).roll.pedals.played;
        const traced = (id: string): Call => ({
            id,
            name: 'InsertPedal',
            options: { pedal: press!.id },
        });
        const result = run([...published.choice, traced('one'), traced('two')]);
        expect(twice(result.mpm)).toContain(`${press!.id}_down`);
        expect(result.problems).toEqual([
            expect.stringMatching(/elements of the MPM share their xml:id/),
        ]);
        // A remark's line for that press stands behind both, and adds no third.
        const said = run([
            ...published.choice,
            traced('one'),
            traced('two'),
            remark('r1', [step('InsertPedal', { pedal: press!.id })]),
        ]);
        expect(said.remarks[0]).toMatchObject({ concrete: [], steps: [{ gaveWayTo: ['one'] }] });
        expect(said.mpm).toBe(result.mpm);
    });
});
