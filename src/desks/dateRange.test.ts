import { describe, expect, it } from 'vitest';
import { rangeCovering, reachedTo } from './dateRange';

describe('the stretch covering a set of dates', () => {
    it('orders the two ends whichever way they were reached for', () => {
        expect(rangeCovering(720, 2880)).toEqual({ from: 720, to: 2880 });
        expect(rangeCovering(2880, 720)).toEqual({ from: 720, to: 2880 });
    });

    it('is the date itself where there is only one', () => {
        expect(rangeCovering(720)).toEqual({ from: 720, to: 720 });
    });

    it('spans a list, not merely its first and last', () => {
        expect(rangeCovering(2880, 720, 4320, 1440)).toEqual({ from: 720, to: 4320 });
    });
});

describe('reaching from a stretch that is already open', () => {
    const range = { from: 720, to: 2880 };

    it('moves the near end and holds the far one', () => {
        expect(reachedTo(range, 4320)).toEqual({ from: 720, to: 4320 });
        expect(reachedTo(range, 0)).toEqual({ from: 0, to: 2880 });
    });

    it('pulls back in where the click lands inside', () => {
        expect(reachedTo(range, 2160)).toEqual({ from: 720, to: 2160 });
        expect(reachedTo(range, 1080)).toEqual({ from: 1080, to: 2880 });
    });

    it('never inverts', () => {
        expect(reachedTo({ from: 2880, to: 4320 }, 720)).toEqual({ from: 720, to: 4320 });
    });
});
