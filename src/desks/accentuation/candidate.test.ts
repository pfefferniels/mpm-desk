import { describe, expect, it } from 'vitest';
import { afterClick, fittable, isPending, rangeOf, type Candidate } from './candidate';

const mintName = () => 'pattern-test';

/** A candidate as the first click leaves it: anchored, its far end still on the cursor. */
const opened = (from: number): Candidate => afterClick(undefined, from, false, mintName);

/** And as the second click leaves it. */
const closed = (from: number, to: number): Candidate => afterClick(opened(from), to, false, mintName);

describe('marking a candidate out', () => {
    it('opens on the first click, with no end yet', () => {
        const candidate = opened(720);

        expect(isPending(candidate)).toBe(true);
        expect(candidate.from).toBe(720);
        expect(candidate.to).toBeUndefined();
        expect(fittable(candidate)).toBe(false);
    });

    it('closes on the second', () => {
        const candidate = closed(720, 2880);

        expect(isPending(candidate)).toBe(false);
        expect(candidate).toMatchObject({ from: 720, to: 2880 });
        expect(fittable(candidate)).toBe(true);
    });

    it('marks the same stretch whichever end is clicked first', () => {
        expect(closed(2880, 720)).toMatchObject({ from: 720, to: 2880 });
    });

    it('starts again where a closed candidate is clicked without shift', () => {
        const restarted = afterClick(closed(720, 2880), 4320, false, mintName);

        expect(isPending(restarted)).toBe(true);
        expect(restarted.from).toBe(4320);
    });

    it('keeps the settings the candidate was opened with', () => {
        expect(closed(720, 2880)).toMatchObject({
            name: 'pattern-test',
            beatLength: 0.125,
            scaleTolerance: 0,
            neutralEnd: true,
        });
    });
});

/**
 * Issue #25. Both halves were the same fault: the shift branch tested `candidate` — the value
 * captured when the handler was made — instead of taking one decision over the candidate as it
 * stands.
 */
describe('shift-clicking', () => {
    it('is not a click behind on a fresh selection', () => {
        // The first click of a fresh selection must still mark: the branch above queues a
        // candidate the branch below cannot see yet, so the shift is easily dropped here.
        const candidate = afterClick(undefined, 720, true, mintName);

        expect(candidate.from).toBe(720);
        expect(isPending(candidate)).toBe(true);
    });

    it('reaches backwards without inverting the range', () => {
        // `{ ...candidate, to: date }` left `from` at 2880 and `to` at 720.
        const reached = afterClick(closed(2880, 4320), 720, true, mintName);

        expect(reached).toMatchObject({ from: 720, to: 4320 });
        expect(fittable(reached)).toBe(true);
    });

    it('moves the end nearer the click and holds the far one', () => {
        const candidate = closed(720, 2880);

        expect(afterClick(candidate, 4320, true, mintName)).toMatchObject({ from: 720, to: 4320 });
        expect(afterClick(candidate, 2160, true, mintName)).toMatchObject({ from: 720, to: 2160 });
    });
});

describe('what the candidate covers', () => {
    it('reaches to the cursor while it is pending', () => {
        expect(rangeOf(opened(720), 2880)).toEqual({ from: 720, to: 2880 });
        expect(rangeOf(opened(2880), 720)).toEqual({ from: 720, to: 2880 });
    });

    it('is the anchor alone before the pointer has moved', () => {
        expect(rangeOf(opened(720))).toEqual({ from: 720, to: 720 });
    });

    it('ignores the cursor once both ends are clicked', () => {
        expect(rangeOf(closed(720, 2880), 5040)).toEqual({ from: 720, to: 2880 });
    });
});
