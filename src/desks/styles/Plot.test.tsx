/**
 * Where a point lands on the paper.
 *
 * The ornamentation plot measures milliseconds of roll, so most of its frame starts are negative,
 * and a scale that ignores the range's lower end puts every one of them outside the viewBox — a
 * pair of axes and nothing else, for a document holding seventy-four fitted spreads. These state
 * the arithmetic a point has to satisfy to be on the paper at all.
 */
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Plot } from './Plot';
import { axisOver } from './axis';
import type { IPoint } from '../../fitting/dbscan';

const point = (value: number[], label = -1): IPoint => ({ value, index: 0, label });

const drawn = (points: IPoint[], width = 200, height = 100) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        createRoot(container).render(
            <Plot
                points={points}
                x={{ label: 'x', min: -200, max: 0 }}
                y={{ label: 'y', min: 0, max: 400 }}
                width={width}
                height={height}
            />,
        );
    });
    return [...container.querySelectorAll('circle')].map(circle => ({
        cx: Number(circle.getAttribute('cx')),
        cy: Number(circle.getAttribute('cy')),
    }));
};

describe('Plot', () => {
    it('places a negative domain across the drawing area', () => {
        expect(drawn([point([-200, 0]), point([-100, 200]), point([0, 400])])).toEqual([
            { cx: 0, cy: 100 },
            { cx: 100, cy: 50 },
            { cx: 200, cy: 0 },
        ]);
    });

    it('leaves out a point the fit could not place', () => {
        expect(drawn([point([]), point([-100, 200])])).toEqual([{ cx: 100, cy: 50 }]);
    });

    it('pads a derived range so nothing sits on an axis', () => {
        const axis = axisOver('frame.start', [point([-180, 0]), point([-20, 0])], 0);
        expect(axis.min).toBeLessThan(-180);
        expect(axis.max).toBeGreaterThan(-20);
    });

    it('reaches its marker and clip by an id a fragment reference can hold', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            createRoot(container).render(
                <>
                    <Plot points={[]} x={{ label: 'x', min: 0, max: 1 }} y={{ label: 'y', min: 0, max: 1 }} width={10} height={10} />
                    <Plot points={[]} x={{ label: 'x', min: 0, max: 1 }} y={{ label: 'y', min: 0, max: 1 }} width={10} height={10} />
                </>,
            );
        });

        const ids = [...container.querySelectorAll('marker, clipPath')].map(node => node.id);
        expect(ids).toHaveLength(4);
        expect(new Set(ids).size).toBe(4);
        ids.forEach(id => { expect(id).toMatch(/^[A-Za-z0-9_-]+$/) });
    });

    it('holds a range open where every point shares one value', () => {
        const axis = axisOver('frame.start', [point([-50, 0]), point([-50, 0])], 0);
        expect(axis.max).toBeGreaterThan(axis.min);
    });
});
