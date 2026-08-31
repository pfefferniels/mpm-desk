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

const mount = (readings: number) => {
    const setSelectedDesk = vi.fn();
    render(
        <AspectSelect
            selectedDesk='metadata'
            setSelectedDesk={setSelectedDesk}
            documentFacts={{ readings }}
        />,
    );
    const label = screen.getByText('source choice');
    return {
        setSelectedDesk,
        row: label.closest('[role="button"]'),
        // `describeChild` puts the reason on the wrapper as a native `title` while the tooltip is
        // closed, and the wrapper is where it has to be: a disabled MUI button dispatches no
        // pointer events, so a tooltip around the row itself would never hear a hover.
        wrapper: label.closest('div[title]'),
    };
};

describe('the aspect menu', () => {
    it('offers Base Text while the document holds two readings', () => {
        const { setSelectedDesk, row, wrapper } = mount(2);
        expect(row).not.toHaveAttribute('aria-disabled', 'true');
        // An empty title is no tooltip, which is what a row with nothing to explain wants.
        expect(wrapper?.getAttribute('title')).toBe('');

        fireEvent.click(row!);
        expect(setSelectedDesk).toHaveBeenCalledWith('source choice');
    });

    it('greys out Base Text when there is only one recording, and says why', () => {
        const { setSelectedDesk, row, wrapper } = mount(1);
        expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(wrapper?.getAttribute('title')).toMatch(/one recording/i);

        fireEvent.click(row!);
        expect(setSelectedDesk).not.toHaveBeenCalled();
    });

    it('keeps every other aspect reachable', () => {
        const { setSelectedDesk } = mount(1);
        fireEvent.click(screen.getByText('tempo'));
        expect(setSelectedDesk).toHaveBeenCalledWith('tempo');
    });
});
