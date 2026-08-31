/**
 * The aspect menu, and the one thing it does beyond listing the registry: it greys out a desk that
 * has nothing to do for the document in hand, and says why.
 *
 * Greyed rather than hidden, which is the rule `ToolbarButton` records for the toolbar — a control
 * that disappears leaves the reader to guess what makes it come back.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AspectSelect } from './AspectSelect';
import { correspondingDesks, type DocumentFacts } from '../desks/DeskSwitch';

/** A document every desk has work to do for — see `DeskSwitch.test.ts`. */
const FITTED: DocumentFacts = { readings: 2, aligned: 476, tempos: 9 };

const mount = (facts: Partial<DocumentFacts>, aspect = 'source choice') => {
    const setSelectedDesk = vi.fn();
    const { container } = render(
        <AspectSelect
            selectedDesk='metadata'
            setSelectedDesk={setSelectedDesk}
            documentFacts={{ ...FITTED, ...facts }}
        />,
    );
    const label = screen.getByText(aspect);
    return {
        setSelectedDesk,
        container,
        row: label.closest('[role="button"]'),
        // `describeChild` puts the reason on the wrapper as a native `title` while the tooltip is
        // closed, and the wrapper is where it has to be: a disabled MUI button dispatches no
        // pointer events, so a tooltip around the row itself would never hear a hover.
        wrapper: label.closest('div[title]'),
    };
};

describe('the aspect menu', () => {
    it('offers Base Text while the document holds two readings', () => {
        const { setSelectedDesk, row, wrapper } = mount({ readings: 2 });
        expect(row).not.toHaveAttribute('aria-disabled', 'true');
        // An empty title is no tooltip, which is what a row with nothing to explain wants.
        expect(wrapper?.getAttribute('title')).toBe('');

        fireEvent.click(row!);
        expect(setSelectedDesk).toHaveBeenCalledWith('source choice');
    });

    it('greys out Base Text when there is only one recording, and says why', () => {
        const { setSelectedDesk, row, wrapper } = mount({ readings: 1 });
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toMatch(/one recording/i);

        fireEvent.click(row!);
        expect(setSelectedDesk).not.toHaveBeenCalled();
    });

    it('offers rubato once a tempo is in the document', () => {
        const { setSelectedDesk, row, wrapper } = mount({}, 'rubato');
        expect(row).not.toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toBe('');

        fireEvent.click(row!);
        expect(setSelectedDesk).toHaveBeenCalledWith('rubato');
    });

    it('greys out rubato before one is, and names the desk that writes it', () => {
        // The case the whole gate is for: a rubato is a distortion of a tempo, so the desk cannot
        // draw or write anything until there is one to be rubato against.
        const { setSelectedDesk, row, wrapper } = mount({ tempos: 0 }, 'rubato');
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toMatch(/tempo desk/i);

        fireEvent.click(row!);
        expect(setSelectedDesk).not.toHaveBeenCalled();
    });

    it('greys out the tempo desk itself while nothing is aligned', () => {
        const { setSelectedDesk, row, wrapper } = mount({ aligned: 0 }, 'tempo');
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toMatch(/aligned/i);

        fireEvent.click(row!);
        expect(setSelectedDesk).not.toHaveBeenCalled();
    });

    it('keeps every other aspect reachable', () => {
        const { setSelectedDesk } = mount({ readings: 1 });
        fireEvent.click(screen.getByText('tempo'));
        expect(setSelectedDesk).toHaveBeenCalledWith('tempo');
    });

    it('rules off each group once', () => {
        // One rule under the heading, then one wherever `group` changes from a row to the next —
        // so with every group written in one run, as `DeskSwitch.tsx` requires, the count is the
        // number of groups. More rules than that is a group split across the list, which reads as
        // two groups and is the one way this arrangement goes wrong silently.
        const { container } = mount({ readings: 1 });
        const groups = new Set(correspondingDesks.map(({ group }) => group));
        expect(container.querySelectorAll('hr')).toHaveLength(groups.size);
    });
});
