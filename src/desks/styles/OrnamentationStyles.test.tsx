/**
 * The ornament style desk in the viewer: the clustering the reconstruction made, at the tolerances
 * of its own call, with nothing left that would make another.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alignment } from '../../fitting/alignment';
import { createMpm } from '../../fitting/instructions/index';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import type { Call } from '../../model/Work';
import { OrnamentationStyles } from './OrnamentationStyles';

const renderDesk = (editable: boolean, calls: Call[] = []) => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    const addTransformer = vi.fn();

    render(
        <EditingContext value={editable}>
            <CallSelectionProvider
                calls={calls}
                outcomes={[]}
                activeCallIds={new Set()}
                setActiveCallIds={vi.fn()}
                onRemoveCalls={vi.fn()}
                focusCall={vi.fn()}
            >
                <DeskToolbarProvider target={bar}>
                    <OrnamentationStyles
                        part='global'
                        msm={new Alignment([])}
                        mpm={createMpm()}
                        residual={null}
                        performanceXml=''
                        secondary={{}}
                        setSecondary={vi.fn()}
                        addTransformer={addTransformer}
                    />
                </DeskToolbarProvider>
            </CallSelectionProvider>
        </EditingContext>,
    );

    return { addTransformer };
};

describe('the ornament style desk', () => {
    it('offers the button and the tolerances in the editor', () => {
        renderDesk(true);

        expect(screen.getByRole('button', { name: 'Stylize Ornaments' })).toBeInTheDocument();
        expect(screen.getAllByRole('slider')).toHaveLength(3);
    });

    it('offers neither in the viewer, and states the tolerances the chain stylized with', () => {
        renderDesk(false, [
            {
                id: 'style',
                name: 'StylizeOrnamentation',
                options: { tickTolerance: 25, intensityTolerance: 0.5, gradientTolerance: 0.3 },
            },
        ]);

        expect(screen.queryByRole('button', { name: 'Stylize Ornaments' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove Style' })).toBeNull();
        expect(screen.queryAllByRole('slider')).toHaveLength(0);
        expect(
            screen.getByText(/frame within 25 ms, intensity within 0.5, gradient within 0.3/),
        ).toBeInTheDocument();
    });

    it('says so in the viewer where the chain stylizes nothing', () => {
        renderDesk(false);

        expect(screen.getByText(/does not stylize its ornaments/)).toBeInTheDocument();
    });
});
