import { describe, expect, test } from 'vitest';
import { paintParts, partStyles } from './paintParts';

/** A rendering as verovio writes one, cut down to the attributes the pass reads. */
const rendered = () => {
    const root = document.createElement('div');
    root.innerHTML = `
        <g data-class="staff" data-n="1" class="staff">
          <g data-class="layer" data-n="1" class="layer">
            <g data-id="a1" data-class="note" class="note"><g class="notehead"><use /></g></g>
            <g data-id="a2" data-class="note" class="note"><g class="notehead"><use /></g></g>
          </g>
        </g>
        <g data-class="staff" data-n="2" class="staff">
          <g data-class="layer" data-n="1" class="layer">
            <g data-id="b1" data-class="note" class="note"><g class="notehead"><use /></g></g>
          </g>
        </g>`;
    return root;
};

const partAttrs = (root: ParentNode) =>
    Object.fromEntries(
        [...root.querySelectorAll('g.note')].map((note) => [
            note.getAttribute('data-id'),
            note.getAttribute('data-part'),
        ]),
    );

describe('paintParts', () => {
    test('writes the part of every note it knows', () => {
        const root = rendered();
        paintParts(root, new Map([['a1', 1], ['a2', 2], ['b1', 2]]), new Set(), undefined);

        expect(partAttrs(root)).toEqual({ a1: '1', a2: '2', b1: '2' });
    });

    test('removes the part of a note that has none, rather than leaving the last one', () => {
        const root = rendered();
        paintParts(root, new Map([['a1', 1]]), new Set(), undefined);
        expect(partAttrs(root)).toEqual({ a1: '1', a2: null, b1: null });

        // A tie continuation or a grace note is in no part at all. Repainting has to take the
        // attribute away again, or it keeps whichever colour it was last given.
        paintParts(root, new Map(), new Set(), undefined);
        expect(partAttrs(root)).toEqual({ a1: null, a2: null, b1: null });
    });

    test('toggles the selection off again, not only on', () => {
        const root = rendered();
        const selected = (id: string) =>
            root.querySelector(`[data-id="${id}"]`)!.classList.contains('voice-selected');

        paintParts(root, new Map(), new Set(['a1']), undefined);
        expect(selected('a1')).toBe(true);

        paintParts(root, new Map(), new Set(['b1']), undefined);
        expect(selected('a1')).toBe(false);
        expect(selected('b1')).toBe(true);
    });

    test('fades every part but the isolated one', () => {
        const root = rendered();
        const faded = () =>
            [...root.querySelectorAll('g.note.voice-faded')].map((n) => n.getAttribute('data-id'));

        paintParts(root, new Map([['a1', 1], ['a2', 2], ['b1', 2]]), new Set(), 2);
        expect(faded()).toEqual(['a1']);

        paintParts(root, new Map([['a1', 1], ['a2', 2], ['b1', 2]]), new Set(), undefined);
        expect(faded()).toEqual([]);
    });

    test('adds and removes no nodes, so the observer that re-runs it cannot hear itself', () => {
        // `Score` re-runs this from a `MutationObserver` on `childList`, because React replaces
        // the SVG whole when the document changes. A pass that touched the child list would
        // trigger its own observer for ever.
        const root = rendered();
        const before = root.innerHTML;
        const nodes = () => root.querySelectorAll('*').length;
        const count = nodes();

        paintParts(root, new Map([['a1', 1]]), new Set(['a1']), 1);

        expect(nodes()).toBe(count);
        // Attributes changed, so the markup is not identical — but the structure is.
        expect(root.innerHTML).not.toBe(before);
        expect([...root.querySelectorAll('g.note')]).toHaveLength(3);
    });
});

describe('partStyles', () => {
    test('sets fill and colour together, or half a note goes unpainted', () => {
        // verovio's own sheet says `path, rect, polygon { stroke: currentColor }`: the notehead
        // takes `fill`, the stem and the beam take `color`.
        for (const rule of partStyles(20).split('\n')) {
            if (!rule.includes('fill:')) continue;
            expect(rule, rule).toContain('color:');
        }
    });

    test('scales the selection halo with what it is passed', () => {
        expect(partStyles(21)).toContain('stroke-width: 21');
    });
});
