import { describe, expect, it } from 'vitest';
import type { DescribedPlace } from '../../fitting/transformers/description/Describe';
import type { Call } from '../../model/Work';
import type { Displaced } from './document';
import { countedOf, displacingOf, gaveWayOf } from './words';

/** Four bars of four quarters, numbered from 16 as a passage in the middle of a piece is. */
const bars = [16, 17, 18, 19].map((n, index) => ({ n, from: index * 2880, to: (index + 1) * 2880 }));
const PASSAGE: DescribedPlace = { kind: 'span', from: 0, to: 5760, notes: [] };
const PIECE: DescribedPlace = { kind: 'piece', from: 0, to: 11520, notes: [] };

const call = (name: string, id: string, options: Record<string, unknown> = {}): Call => ({ id, name, options });
const tempo = (id: string, from: number, to: number) => call('InsertTempo', id, { from, to });
/** A call that goes entirely, or one of which `left` is put in its place. */
const gone = (made: Call, ...left: Call[]): Displaced => ({ call: made, left });

describe('calls made by hand, counted', () => {
    it('are called what their own desks call them, one or several', () => {
        expect(countedOf([tempo('a', 0, 1)])).toBe('1 tempo');
        expect(countedOf([tempo('a', 0, 1), tempo('b', 1, 2)])).toBe('2 tempos');
        expect(countedOf([call('InsertDynamics', 'a'), call('InsertTemporalSpread', 'b'), call('InsertTemporalSpread', 'c')])).toBe(
            '1 dynamics curve and 2 spreads',
        );
        expect(countedOf([call('InsertPedal', 'a'), call('InsertRubato', 'b'), call('InsertMetricalAccentuation', 'c')])).toBe(
            '1 pedal line, 1 rubato and 1 accentuation pattern',
        );
    });

    it('go by their name where no desk has a word for them', () => {
        expect(countedOf([call('SomethingNew', 'a'), call('SomethingNew', 'b')])).toBe('2 SomethingNew calls');
    });

    it('are only counted where the document does not show them any more', () => {
        const madeByHand = new Map([['a', tempo('a', 0, 1)]]);
        expect(gaveWayOf(['a'], madeByHand)).toBe('1 tempo');
        expect(gaveWayOf(['a', 'gone'], madeByHand)).toBe('2 calls');
        expect(gaveWayOf(['gone'], madeByHand)).toBe('1 call');
    });
});

describe('what an answer would take the place of, as the reader is asked', () => {
    it('says what kind, how many and where', () => {
        const five = [0, 720, 1440, 2880, 4320].map((from, index) => gone(tempo(`t${String(index)}`, from, from + 720)));
        expect(displacingOf(five, PASSAGE, bars)).toBe('take the place of 5 tempos drawn by hand in bars 16–17');
        expect(displacingOf([gone(tempo('t', 2880, 5760))], PASSAGE, bars)).toBe('take the place of 1 tempo drawn by hand in bar 17');
    });

    it('joins several kinds in the one sentence', () => {
        const mixed = [gone(tempo('t', 0, 2880)), gone(tempo('u', 2880, 5760)), gone(call('InsertDynamics', 'd', { from: 0, to: 5760 })), gone(call('InsertTemporalSpread', 's', { date: 1440 }))];
        expect(displacingOf(mixed, PASSAGE, bars)).toBe('take the place of 2 tempos, 1 dynamics curve and 1 spread drawn by hand in bars 16–17');
    });

    it('looks no further than the remark, where a call runs on outside it', () => {
        // A tempo over all four bars, met by a remark on the first two.
        const long = tempo('t', 0, 11520);
        const cut = gone(long, tempo('t', 5760, 11520));
        expect(displacingOf([cut], PASSAGE, bars)).toBe('take the place of 1 tempo drawn by hand in bars 16–17, leaving what it says elsewhere');
        // A remark on the whole piece has no stretch of its own to stop at.
        expect(displacingOf([gone(long)], PIECE, bars)).toBe('take the place of 1 tempo drawn by hand in bars 16–19');
    });

    it('says how many are only cut into', () => {
        const whole = gone(tempo('a', 0, 2880));
        const cut = gone(tempo('b', 2880, 8640), tempo('b', 5760, 8640));
        const other = gone(tempo('c', 0, 8640), tempo('c', 5760, 8640));
        expect(displacingOf([whole, cut], PASSAGE, bars)).toBe('take the place of 2 tempos drawn by hand in bars 16–17, leaving what 1 of them says elsewhere');
        expect(displacingOf([cut, other], PASSAGE, bars)).toBe('take the place of 2 tempos drawn by hand in bars 16–17, leaving what they say elsewhere');
    });

    it('says no place where none of them names one', () => {
        expect(displacingOf([gone(call('InsertPedal', 'p', { pedal: 'press-1' }))], PASSAGE, bars)).toBe('take the place of 1 pedal line drawn by hand');
    });
});
