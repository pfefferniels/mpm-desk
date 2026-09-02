import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alignment } from '../../fitting/alignment';
import { ArticulationStyles } from './ArticulationStyles';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import {
    createMpm,
    ensureDefaultStyle,
    insertDefinition,
    requireMap,
} from '../../fitting/instructions/index';
import type { Mpm, Scope } from '../../fitting/instructions/index';
import {
    makeArticulationDef,
    type ArticulationModifiers,
} from '../../fitting/transformers/articulation/InsertArticulation';

/**
 * One `<articulation>` in `scope`, articulating whatever its definition states.
 *
 * The values go on the def and not on the instruction, which is where `InsertArticulation` puts
 * them and the whole reason `StylizeArticulation.effectiveOf` exists — an instruction read on its
 * own says nothing at all.
 */
const articulate = (scope: Scope, modifiers: ArticulationModifiers, mpm: Mpm = createMpm()) => {
    const name = `def_${scope}`;
    insertDefinition(mpm, 'articulationDef', makeArticulationDef(name, modifiers), scope);
    ensureDefaultStyle(mpm, 'articulation', scope);
    requireMap(mpm, 'articulation', scope).addArticulation({
        date: 0,
        noteid: '#n1',
        nameRef: name,
        id: `articulation_${scope}`,
    });
    return mpm;
};

/** Both relative attributes and no absolute one: the only shape a shared def can cover. */
const clusterable = { relativeDuration: 1.1, relativeVelocity: 0.9 };

const renderDesk = (mpm: Mpm, part: Scope = 'global') => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    const addTransformer = vi.fn();

    const { container } = render(
        <DeskToolbarProvider target={bar}>
            <ArticulationStyles
                part={part}
                msm={new Alignment([])}
                mpm={mpm}
                residual={null}
                projected={[]}
                performanceXml=''
                secondary={{}}
                setSecondary={vi.fn()}
                addTransformer={addTransformer}
            />
        </DeskToolbarProvider>,
    );

    return {
        addTransformer,
        plot: () => container.querySelector('svg'),
        emptyNote: () => screen.queryByText(/Nothing here to cluster/),
        button: () => screen.getByRole('button', { name: 'Stylize Articulations' }),
    };
};

describe('the plot', () => {
    it('says why it is empty where the scope holds no articulation', () => {
        const { plot, emptyNote } = renderDesk(createMpm());

        expect(emptyNote()).toBeInTheDocument();
        expect(plot()).toBeNull();
    });

    /**
     * Issue #41's second state, and the one a count of the points would miss. `clustersOf` answers
     * one point per articulation whether it can place it or not, so this scope hands the plot a
     * point that carries no coordinates: two axes over nothing, with no word about it.
     */
    it('says the same where nothing in the scope can be placed', () => {
        const { plot, emptyNote } = renderDesk(
            articulate('global', { absoluteDuration: 400, ...clusterable }),
        );

        expect(emptyNote()).toBeInTheDocument();
        expect(plot()).toBeNull();
    });

    it('draws once the scope holds something to cluster', () => {
        const { plot, emptyNote } = renderDesk(articulate('global', clusterable));

        expect(emptyNote()).toBeNull();
        expect(plot()).not.toBeNull();
    });

    /** The picker narrows the plot, so a part's articulations are no answer for `global`. */
    it('is empty in a scope whose articulations are elsewhere', () => {
        const { emptyNote } = renderDesk(articulate(1, clusterable), 'global');

        expect(emptyNote()).toBeInTheDocument();
    });
});

describe('the button', () => {
    it('is dead while nothing in the document can be clustered', () => {
        expect(renderDesk(createMpm()).button()).toBeDisabled();
    });

    /**
     * The gate is the document and not the scope on screen: `transform` restyles every scope it
     * finds, so a call made from an empty plot still defines the part's styles.
     */
    it('stays live over an empty plot while another scope has candidates', () => {
        const { button, emptyNote } = renderDesk(articulate(1, clusterable), 'global');

        expect(emptyNote()).toBeInTheDocument();
        expect(button()).toBeEnabled();
    });

    it('commits the tolerances the sliders carry', () => {
        const { button, addTransformer } = renderDesk(articulate('global', clusterable));

        button().click();

        expect(addTransformer).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    volumeTolerance: 0.05,
                    relativeDurationTolerance: 0.15,
                }),
            }),
        );
    });
});
