/**
 * What a later call leaves of an earlier one that speaks of the same place: the rule the remarks
 * are settled by among themselves, and with the calls made by hand.
 */
import { describe, expect, it } from 'vitest';
import { leave, type Places } from '../../../src/fitting/description/settle';
import { getTempoAt } from '../../../src/fitting/transformers/index';
import type { Call } from '../../../src/model/Work';

/** A chord on every quarter of four bars, and one roll over every chord that describes two of them. */
const places: Places = {
    dates: Array.from({ length: 17 }, (_, quarter) => quarter * 720),
    rolled: () => new Set([720, 2160]),
};

const call = (name: string, options: Record<string, unknown>, id = name): Call => ({
    id,
    name,
    options: { scope: 'global', ...options },
});

const lineOf = ({ options }: Call) => ({
    date: options['from'] as number,
    endDate: options['to'] as number,
    bpm: options['bpm'] as number,
    transitionTo: options['transitionTo'] as number,
    meanTempoAt: options['meanTempoAt'] as number,
    beatLength: 0.25,
});

describe('a tempo', () => {
    const drawn = call('InsertTempo', {
        from: 0,
        to: 5760,
        bpm: 60,
        transitionTo: 96,
        meanTempoAt: 0.3,
        beatLength: 0.25,
    });
    const said = call('FitTempo', { from: 1440, to: 4320, beatLength: 0.25, shape: 'steady' });

    it('is left alone by one that does not reach it, and by a span of no length', () => {
        expect(leave(drawn, call('FitTempo', { from: 5760, to: 8640 }), places)).toEqual([drawn]);
        expect(leave(drawn, call('InsertTempo', { from: 1440, to: 1440 }), places)[0]).toBe(drawn);
        // Another part's tempo map is another map.
        expect(leave(drawn, call('FitTempo', { from: 1440, to: 4320, scope: 0 }), places)[0]).toBe(
            drawn,
        );
    });

    it('goes entirely where the later span holds its own date and its end', () => {
        expect(leave(call('InsertTempo', { from: 1440, to: 2880, bpm: 50 }), said, places)).toEqual(
            [],
        );
        // Stated on one date, with no span of its own: its `<tempo>` would stand inside all the same.
        expect(leave(call('InsertTempo', { from: 2160, to: 2160, bpm: 50 }), said, places)).toEqual(
            [],
        );
        expect(leave(call('InsertTempo', { from: 1440, to: 1440, bpm: 50 }), said, places)).toEqual(
            [],
        );
    });

    it('keeps its line up to the cut to the letter, where it was drawn', () => {
        const [before, after] = leave(drawn, said, places);
        expect(before?.options).toMatchObject({ from: 0, to: 1440, bpm: 60, meanTempoAt: 0.3 });
        expect(before?.options['transitionTo']).toBe(getTempoAt(1440, lineOf(drawn)));
        for (let date = 0; date <= 1440; date += 90) {
            expect(getTempoAt(date, lineOf(before!))).toBeCloseTo(
                getTempoAt(date, lineOf(drawn)),
                9,
            );
        }

        // From the cut on it starts at the tempo it had there, arrives where it was going, and
        // reaches its own mean tempo on the date the line did: as near as one `<tempo>` comes.
        expect(after?.options).toMatchObject({ from: 4320, to: 5760, transitionTo: 96 });
        expect(after?.options['bpm']).toBe(getTempoAt(4320, lineOf(drawn)));
        const mean = ((after!.options['bpm'] as number) + 96) / 2;
        const meanAt = 4320 + (after!.options['meanTempoAt'] as number) * 1440;
        expect(getTempoAt(meanAt, lineOf(drawn))).toBeCloseTo(mean, 6);
        for (let date = 4320; date <= 5760; date += 90) {
            expect(
                Math.abs(getTempoAt(date, lineOf(after!)) - getTempoAt(date, lineOf(drawn))),
            ).toBeLessThan(0.2);
        }
        // What is left of a call goes by its id, and carries nothing a run recorded on it.
        expect([before, after].map((left) => Object.keys(left!))).toEqual([
            ['id', 'name', 'options'],
            ['id', 'name', 'options'],
        ]);
    });

    it('stays steady where it was steady, and is fitted again where it was fitted', () => {
        const steady = call('InsertTempo', { from: 0, to: 5760, bpm: 60, beatLength: 0.25 });
        expect(leave(steady, said, places).map(({ options }) => options)).toEqual([
            { ...steady.options, to: 1440 },
            { ...steady.options, from: 4320 },
        ]);
        const fitted = call('FitTempo', {
            from: 0,
            to: 5760,
            beatLength: 0.25,
            shape: 'transition',
        });
        expect(
            leave(fitted, said, places).map(({ options }) => [options['from'], options['to']]),
        ).toEqual([
            [0, 1440],
            [4320, 5760],
        ]);
    });
});

describe('dynamics', () => {
    const said = call('FitDynamics', { from: 1440, to: 2880 });

    it('end on the chord before the later span and begin again on the chord after it', () => {
        const drawn = call('InsertDynamics', { from: 0, to: 5760, guides: new Map() });
        expect(
            leave(drawn, said, places).map(({ options }) => [options['from'], options['to']]),
        ).toEqual([
            [0, 720],
            [3600, 5760],
        ]);
        // One that ends on the later span's first chord would leave its last instruction there.
        const ending = call('InsertDynamics', { from: 0, to: 1440, guides: new Map() });
        expect(leave(ending, said, places).map(({ options }) => options['to'])).toEqual([720]);
        const beginning = call('FitDynamics', { from: 2880, to: 4320 });
        expect(leave(beginning, said, places).map(({ options }) => options['from'])).toEqual([
            3600,
        ]);
    });

    it('may end on a guide of their own between two chords', () => {
        const guided = call('InsertDynamics', {
            from: 0,
            to: 5760,
            guides: new Map([
                [1000, 30],
                [3000, 40],
            ]),
        });
        expect(
            leave(guided, said, places).map(({ options }) => [options['from'], options['to']]),
        ).toEqual([
            [0, 1000],
            [3000, 5760],
        ]);
    });

    it('go entirely where nothing of them is left to stand on, and are left alone otherwise', () => {
        expect(leave(call('InsertDynamics', { from: 1440, to: 2880 }), said, places)).toEqual([]);
        expect(leave(call('InsertDynamics', { from: 2160, to: 2160 }), said, places)).toEqual([]);
        const apart = call('InsertDynamics', { from: 3600, to: 5760 });
        expect(leave(apart, said, places)[0]).toBe(apart);
        expect(leave(apart, call('InsertDynamics', { from: 4320, to: 4320 }), places)[0]).toBe(
            apart,
        );
    });
});

describe('what is said of one place', () => {
    it('goes for a later rubato over its frame, a roll on its chord, a line of its press', () => {
        const rubato = call('InsertRubato', { date: 720, length: 720 });
        expect(leave(rubato, call('InsertRubato', { date: 1080, length: 720 }), places)).toEqual(
            [],
        );
        expect(leave(rubato, call('InsertRubato', { date: 1440, length: 720 }), places)[0]).toBe(
            rubato,
        );

        const roll = call('InsertTemporalSpread', { date: 720, placement: 'estimate' });
        expect(
            leave(roll, call('InsertTemporalSpread', { date: 720, placement: 'on-beat' }), places),
        ).toEqual([]);
        expect(leave(roll, call('InsertTemporalSpread', { date: 1440 }), places)[0]).toBe(roll);
        expect(leave(roll, call('InsertTemporalSpread', { date: 720, scope: 0 }), places)[0]).toBe(
            roll,
        );
        expect(leave(roll, call('InsertDynamicsGradient', { date: 720 }), places)[0]).toBe(roll);

        const press = call('InsertPedal', { pedal: 'sustain-720', guides: new Map() });
        expect(leave(press, call('InsertPedal', { pedal: 'sustain-720' }), places)).toEqual([]);
        expect(leave(press, call('InsertPedal', { pedal: 'sustain-1440' }), places)[0]).toBe(press);
    });

    it('goes for a later call over every chord that describes it, or over every press', () => {
        const over = call('InsertTemporalSpread', { placement: 'estimate', durationThreshold: 35 });
        const rolled = call('InsertTemporalSpread', { date: 720 });
        const plain = call('InsertTemporalSpread', { date: 1440 });
        expect(leave(rolled, over, places)).toEqual([]);
        expect(leave(plain, over, places)[0]).toBe(plain);
        expect(
            leave(call('InsertPedal', { pedal: 'sustain-720' }), call('InsertPedal', {}), places),
        ).toEqual([]);

        // And is never undone for one chord, or one press, by what is said of that alone.
        expect(leave(over, rolled, places)[0]).toBe(over);
        const every = call('InsertPedal', {});
        expect(leave(every, call('InsertPedal', { pedal: 'sustain-720' }), places)[0]).toBe(every);
    });
});
