import { describe, expect, it } from 'vitest';
import { VELOCITY_TICK, velocityAxis } from './velocityAxis';

/**
 * A velocity plot shows what it draws. The dynamics and corrections desks drew velocity 127 at
 * the head of a 320 pixel chart and 20 at its foot, and the notes of WM 225 that `Expand` and
 * `Modify` took below that, 59 dots of 430, were drawn off the chart.
 */

const height = 320;

/** WM 225, globally: recorded velocities from 35 to 62, corrected ones down to 8. */
const wm225 = [8, 11, 35, 46, 54, 62];

describe('velocityAxis', () => {
    it('draws every value it was given inside the plot, clear of both edges', () => {
        const axis = velocityAxis(wm225, height);

        for (const velocity of wm225) {
            expect(axis.y(velocity)).toBeGreaterThan(0);
            expect(axis.y(velocity)).toBeLessThan(height);
        }
    });

    it('reaches past the softest and the loudest, and starts and ends on a tick', () => {
        const axis = velocityAxis(wm225, height);

        expect(axis.min).toBeLessThan(8);
        expect(axis.max).toBeGreaterThan(62);
        expect(axis.min % VELOCITY_TICK).toBe(0);
        expect(axis.max % VELOCITY_TICK).toBe(0);
        // And no further than it has to: the head of the old chart was 65 steps of nothing.
        expect(axis.max).toBeLessThanOrEqual(62 + 2 * VELOCITY_TICK);
    });

    it('puts the loud end at the top', () => {
        const axis = velocityAxis(wm225, height);

        expect(axis.y(axis.max)).toBeLessThan(axis.y(axis.min));
        expect(axis.y(axis.min) - axis.y(axis.max)).toBeCloseTo(
            (axis.max - axis.min) * axis.perStep,
        );
    });

    it('reads a pointer back as the velocity drawn under it', () => {
        const axis = velocityAxis(wm225, height);

        for (const velocity of [0, 8, 33.5, 62, 127]) {
            expect(axis.velocityAt(axis.y(velocity))).toBeCloseTo(velocity);
        }
    });

    it('shows no velocity MIDI cannot have', () => {
        const axis = velocityAxis([1, 126], height);

        expect(axis.min).toBe(0);
        expect(axis.max).toBe(127);
        expect(axis.y(0)).toBeLessThan(height);
        expect(axis.y(127)).toBeGreaterThan(0);
    });

    it('does not magnify a part struck at one velocity', () => {
        const axis = velocityAxis([64, 64, 64], height);

        expect(axis.max - axis.min).toBeGreaterThanOrEqual(30);
        expect(axis.y(64)).toBeGreaterThan(0);
        expect(axis.y(64)).toBeLessThan(height);
    });

    it('passes over what is not a number, and shows everything when nothing is left', () => {
        const extent = (velocities: number[]) => {
            const { min, max } = velocityAxis(velocities, height);
            return { min, max };
        };

        expect(extent([NaN, 40, Infinity])).toEqual(extent([40]));
        expect(extent([])).toEqual({ min: 0, max: 127 });
    });
});
