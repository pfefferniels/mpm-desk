import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolbarButton, ToolbarToggle } from './ToolbarButton';

describe('ToolbarButton', () => {
    /**
     * The bar greys controls out rather than hiding them, so "disabled" has to stay a *visible*
     * state: a control that vanishes when it cannot be used teaches nobody what would bring it
     * back. This is also the assertion that would fail first if the tooltip's wrapper `<span>` were
     * ever made conditional on `disabled`.
     */
    it('renders a disabled button rather than omitting it', () => {
        render(
            <ToolbarButton tooltip='Select two segments first' disabled onClick={() => {}}>
                Merge
            </ToolbarButton>,
        );

        expect(screen.getByRole('button', { name: 'Select two segments first' })).toBeDisabled();
    });

    it('names the button after its label when one is given', () => {
        render(
            <ToolbarButton tooltip='Merge the selected segments' label='Merge' onClick={() => {}}>
                Merge
            </ToolbarButton>,
        );

        expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
    });

    it('names the button after its tooltip when no label is given', () => {
        render(
            <ToolbarButton tooltip='Merge the selected segments' onClick={() => {}}>
                Merge
            </ToolbarButton>,
        );

        expect(
            screen.getByRole('button', { name: 'Merge the selected segments' }),
        ).toBeInTheDocument();
    });

    /**
     * An icon carries no text, so without the name stated outright this button would be announced
     * as "button" and nothing else — the failure that is invisible to everyone who can see the
     * icon.
     */
    it('gives an icon-only button an accessible name', () => {
        render(
            <ToolbarButton tooltip='Play' icon={<svg role='presentation' />} onClick={() => {}} />,
        );

        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    });

    it('calls onClick', () => {
        const onClick = vi.fn();
        render(
            <ToolbarButton tooltip='Translate to ticks' onClick={onClick}>
                Translate
            </ToolbarButton>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Translate to ticks' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('ToolbarToggle', () => {
    /**
     * The two assertions are on the *whole* argument list, not just the first argument. That is the
     * point of the wrapper: MUI would hand the caller `(event, 'on')` on the way in and `(event,
     * 'on')` on the way out, or `(event, null)` from inside an exclusive group, and every desk
     * reconstructed the intent from state it already held. Here the toggle answers it.
     */
    it('reports the state it is about to enter', () => {
        const onChange = vi.fn();
        render(
            <ToolbarToggle tooltip='Draw' selected={false} onChange={onChange}>
                Draw
            </ToolbarToggle>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
        expect(onChange.mock.calls).toEqual([[true]]);
    });

    it('reports the state it is about to leave', () => {
        const onChange = vi.fn();
        render(
            <ToolbarToggle tooltip='Draw' selected onChange={onChange}>
                Draw
            </ToolbarToggle>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
        expect(onChange.mock.calls).toEqual([[false]]);
    });
});
