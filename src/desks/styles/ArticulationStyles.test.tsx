import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alignment } from '../../fitting/alignment';
import { ArticulationStyles } from './ArticulationStyles';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import type { Call } from '../../model/Work';
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
 *
 * @param key names the def and the instruction, for a second articulation in one scope
 */
const articulate = (
    scope: Scope,
    modifiers: ArticulationModifiers,
    mpm: Mpm = createMpm(),
    key = String(scope),
) => {
    const name = `def_${key}`;
    insertDefinition(mpm, 'articulationDef', makeArticulationDef(name, modifiers), scope);
    ensureDefaultStyle(mpm, 'articulation', scope);
    requireMap(mpm, 'articulation', scope).addArticulation({
        date: 0,
        noteid: `#n_${key}`,
        nameRef: name,
        id: `articulation_${key}`,
    });
    return mpm;
};

/** Both relative attributes and no absolute one: the only shape a shared def can cover. */
const clusterable = { relativeDuration: 1.1, relativeVelocity: 0.9 };

interface DeskOptions {
    /** False for the viewer. */
    editable?: boolean;
    /** The chain, where the viewer looks for the `StylizeArticulation` that was made. */
    calls?: Call[];
    /** The document as that call found it. */
    found?: Mpm | null;
}

const renderDesk = (
    mpm: Mpm,
    part: Scope = 'global',
    { editable = true, calls = [], found }: DeskOptions = {},
) => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    const addTransformer = vi.fn();

    const { container } = render(
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
                    <ArticulationStyles
                        part={part}
                        msm={new Alignment([])}
                        mpm={mpm}
                        found={found}
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

    return {
        addTransformer,
        plot: () => container.querySelector('svg'),
        points: () => [...container.querySelectorAll('circle')],
        emptyNote: () => screen.queryByText(/this plot shows the scope the bar is set to/),
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
     * Issue #41's second state, and the one a count of the points would miss: one point per
     * articulation, none of which has a place on the plot. An absolute duration replaces the
     * notated one, so it is no ratio of it.
     */
    it('says why where every articulation in the scope has an absolute duration', () => {
        const { plot, emptyNote } = renderDesk(
            articulate('global', { absoluteDuration: 400, ...clusterable }),
        );

        expect(emptyNote()).toHaveTextContent(/absolute duration/);
        expect(plot()).toBeNull();
    });

    /**
     * The reconstruction's own shape. `InsertArticulation` states only the aspects a call
     * measured, and 56 of the 65 articulations name a def stating a relative duration alone. The
     * clustering places none of those, and drawing only what it placed showed 3 points at Global.
     */
    it('draws an articulation whose def states a relative duration alone, at a volume of 1', () => {
        const { points } = renderDesk(articulate('global', { relativeDuration: 1.2 }));

        expect(points()).toHaveLength(1);
        // 0.5 to 1.5 over 400px, so a volume of 1 is halfway down. Grey: no shared def can
        // carry it, since the def states no velocity to merge.
        expect(points()[0]).toHaveAttribute('cy', '200');
        expect(points()[0]).toHaveAttribute('fill', '#9ca3af');
    });

    it('draws one whose def states a volume alone, widening the axis rather than clipping it', () => {
        const { points } = renderDesk(articulate('global', { relativeVelocity: 1.78 }));

        expect(points()).toHaveLength(1);
        expect(Number(points()[0]?.getAttribute('cy'))).toBeGreaterThanOrEqual(0);
    });

    it('counts under the plot what it cannot draw', () => {
        const mpm = articulate('global', clusterable);
        articulate('global', { absoluteDuration: 400 }, mpm, 'absolute');

        const { points } = renderDesk(mpm);

        expect(points()).toHaveLength(1);
        expect(screen.getByText(/Not drawn: 1 with an absolute duration/)).toBeInTheDocument();
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

describe('once stylized', () => {
    const style: Call = {
        id: 'style',
        name: 'StylizeArticulation',
        options: { volumeTolerance: 0.3, relativeDurationTolerance: 0.4 },
    };

    /**
     * The call takes the largest cluster's instructions away for a `defaultArticulation` and
     * repoints the rest at their cluster's mean, so the finished document no longer holds what
     * was clustered. The desk draws the document the call found instead.
     */
    it('draws the articulations as the call found them', () => {
        const { points } = renderDesk(createMpm(), 'global', {
            calls: [style],
            found: articulate('global', clusterable),
        });

        expect(points()).toHaveLength(1);
    });

    it('holds the tolerances at the call, and offers Remove Style instead of a second call', () => {
        const { button } = renderDesk(createMpm(), 'global', {
            calls: [style],
            found: articulate('global', clusterable),
        });

        expect(button()).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove Style' })).toBeEnabled();
        const sliders = screen.getAllByRole('slider');
        expect(sliders.map((slider) => slider.getAttribute('aria-valuenow'))).toEqual(['0.3', '0.4']);
        sliders.forEach((slider) => {
            expect(slider).toBeDisabled();
        });
    });
});

describe('in the viewer', () => {
    it('sends nobody to fit anything where the scope holds no articulation', () => {
        const { emptyNote } = renderDesk(createMpm(), 'global', { editable: false });

        expect(emptyNote()).toHaveTextContent(/The reconstruction articulates nothing in this scope/);
        expect(emptyNote()).not.toHaveTextContent(/Fit/);
    });

    it('offers neither the button nor the tolerances, and says it stylized nothing', () => {
        const { plot } = renderDesk(articulate('global', clusterable), 'global', { editable: false });

        expect(screen.queryByRole('button', { name: 'Stylize Articulations' })).toBeNull();
        expect(screen.queryAllByRole('slider')).toHaveLength(0);
        expect(screen.getByText(/does not stylize its articulations/)).toBeInTheDocument();
        expect(plot()).not.toBeNull();
    });

    it('clusters at the tolerances the chain stylized with', () => {
        renderDesk(articulate('global', clusterable), 'global', {
            editable: false,
            calls: [
                {
                    id: 'style',
                    name: 'StylizeArticulation',
                    options: { volumeTolerance: 0.3, relativeDurationTolerance: 0.4 },
                },
            ],
        });

        expect(screen.getByText(/volume within 0.3, duration within 0.4/)).toBeInTheDocument();
    });
});
