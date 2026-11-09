import { describe, expect, it } from 'vitest';
import { callAddress, callAt, MIN_ADDRESS } from './callAddress';

const ids = [
    '2aac2b1a-7be2-4182-8503-7cc3d7a03229',
    '9f8b5d24-4423-431f-80dc-5178e79af043',
    '9f8b5d24-aaaa-431f-80dc-5178e79af043',
];
const calls = ids.map((id) => ({ id }));

describe('a call’s address', () => {
    it('is the first eight characters where nothing else starts so', () => {
        expect(callAddress(ids[0], ids)).toBe('2aac2b1a');
    });

    it('grows until it names one call', () => {
        expect(callAddress(ids[1], ids)).toBe('9f8b5d24-4');
        expect(callAddress(ids[2], ids)).toBe('9f8b5d24-a');
    });

    it('is the whole id where nothing shorter will do, and that names it', () => {
        const nested = ['9f8b5d24', '9f8b5d24-x'];
        expect(callAddress('9f8b5d24', nested)).toBe('9f8b5d24');
        expect(callAt('9f8b5d24', nested.map((id) => ({ id })))?.id).toBe('9f8b5d24');
    });
});

describe('the call an address names', () => {
    it('resolves the address, and the whole id, to the call', () => {
        for (const id of ids) {
            expect(callAt(callAddress(id, ids), calls)?.id).toBe(id);
            expect(callAt(id, calls)?.id).toBe(id);
        }
    });

    it('names none where several calls start so, rather than the first', () => {
        expect(callAt('9f8b5d24', calls)).toBeUndefined();
    });

    it('takes nothing shorter than an address for one', () => {
        expect(callAt(ids[0].slice(0, MIN_ADDRESS - 1), calls)).toBeUndefined();
        expect(callAt('', calls)).toBeUndefined();
    });

    it('names none where no call starts so: an old segment link, say', () => {
        expect(callAt('0fad3105', calls)).toBeUndefined();
    });
});
