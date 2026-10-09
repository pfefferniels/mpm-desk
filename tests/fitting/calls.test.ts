/**
 * Reading a saved call as the transformer it names.
 */
import { describe, expect, expectTypeOf, test } from 'vitest';
import { isCallOf } from '../../src/fitting/calls';
import type { CorrectPedalOptions } from '../../src/fitting/transformers/modification/CorrectPedal';
import type { Call } from '../../src/model/Work';

const calls: Call[] = [
    { id: 'a', name: 'Modify', options: { aspect: 'velocity', change: 3, from: 0, to: 720 } },
    { id: 'b', name: 'CorrectPedal', options: { pedal: 'pedal-1', remove: true } },
    { id: 'c', name: 'Align', options: { source: 'take-1' } },
];

describe('isCallOf', () => {
    test('picks out the calls naming the transformer, and no other', () => {
        expect(calls.filter(isCallOf('CorrectPedal')).map((call) => call.id)).toEqual(['b']);
        expect(calls.filter(isCallOf('InsertTempo'))).toEqual([]);
    });

    test("types the options as that transformer's", () => {
        const [call] = calls.filter(isCallOf('CorrectPedal'));
        expectTypeOf(call!.options).toExtend<CorrectPedalOptions>();
    });

    test('takes only a name the registry holds, under its current spelling', () => {
        // @ts-expect-error `Align` is applied to the score, not registered.
        isCallOf('Align');
        // @ts-expect-error a retired spelling is an alias, not a name a call is read under.
        isCallOf('TranslatePhyiscalTimeToTicks');
    });
});
