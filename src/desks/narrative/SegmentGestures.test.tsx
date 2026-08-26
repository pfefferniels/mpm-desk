/**
 * The desk's gesture column, over the reconstruction the app actually ships.
 *
 * What is worth pinning is that the desk draws the *viewer's* picture rather than a second
 * version of it — a segment that reads one way while it is being assembled and another way
 * once it is published is a desk lying to its editor. So the assertions are about the whole
 * path: a projected segment ⇒ the shared timeline ⇒ a lane per kind of gesture, curves where
 * the viewer draws curves.
 *
 * The quotation is the one thing the desk has that the card does not, and it is checked at the
 * lane the card would refuse to open: `tempo`, which the viewer treats as already answered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { readPerformance } from '../../utils/mpm';
import { readMeter } from '../../utils/score';
import type { Reconstruction, Segment } from '../../model/Reconstruction';
import { SegmentGestures } from './SegmentGestures';

const { segments } = JSON.parse(
    readFileSync('src/test/fixtures/segments.json', 'utf-8'),
) as Reconstruction;

const mpm = readPerformance(
    readFileSync('src/test/fixtures/performance.mpm', 'utf-8'),
    readMeter(readFileSync('src/test/fixtures/score.msm', 'utf-8')),
);

/** Six kinds of gesture in one segment: two pedals, a tempo, a dynamics, and two undrawn. */
const rich = segments.find((segment) => segment.id === 'argumentation-915c7d64');
if (!rich) throw new Error('the fixture no longer holds the segment these tests are about');

const render = async (segment: Segment | undefined) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <SegmentGestures
                gestures={segment}
                mpm={mpm}
                minPointSpan={720}
                beatLength={720}
            />,
        );
    });
    return {
        container,
        cleanup: () => {
            act(() => {
                root.unmount();
            });
            container.remove();
        },
    };
};

/** React synthesizes `onMouseEnter` out of `mouseover`, so that is what a pointer is here. */
const point = async (element: Element) => {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
};

describe('a segment’s gestures in the narrative desk', () => {
    it('draws one lane per kind of gesture, named', async () => {
        const { container, cleanup } = await render(rich);

        const labels = [...container.querySelectorAll('text')].map((node) => node.textContent);
        // Both pedals are named by their controller rather than by `movement`, so the two
        // lanes can be told apart — the same thing the card does.
        expect(labels).toEqual(
            expect.arrayContaining(['tempo', 'dynamics', 'ornament', 'articulation']),
        );
        // Six spans over five lanes: the two pedals are separate lanes, the rest one each.
        expect(new Set(labels).size).toBeGreaterThanOrEqual(5);

        cleanup();
    });

    it('draws the shaped lanes as curves', async () => {
        const { container, cleanup } = await render(rich);

        // A path per drawn lane, each with more than the two points a straight line would need.
        const lines = [...container.querySelectorAll('path')]
            .map((node) => node.getAttribute('d') ?? '')
            .filter((d) => d.includes('L'));
        expect(lines.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...lines.map((d) => d.split('L').length))).toBeGreaterThan(10);

        cleanup();
    });

    it('quotes the document for a lane the viewer’s card would not open', async () => {
        const { container, cleanup } = await render(rich);
        expect(container.textContent).not.toContain('bpm');

        // The tempo row: a curve, which in the viewer takes no pointer at all.
        const row = [...container.querySelectorAll('svg > g')].find(
            (node) => node.querySelector('text')?.textContent === 'tempo',
        );
        expect(row).toBeDefined();
        const hit = row!.querySelector('rect[fill="transparent"]');
        expect(hit).not.toBeNull();

        await point(hit!);
        // The instruction's own words, not the curve's reading of them.
        expect(container.textContent).toContain('bpm');

        cleanup();
    });

    it('says so when the run left the segment nothing to draw', async () => {
        const { container, cleanup } = await render(undefined);

        expect(container.querySelector('svg')).toBeNull();
        expect(container.textContent).toContain('nothing left to draw');
        // Why, kept off the row itself: it is a paragraph, and every such row would carry it.
        expect(container.querySelector('span')?.getAttribute('title')).toContain(
            'removed or merged away again',
        );

        cleanup();
    });
});
