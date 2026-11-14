/**
 * The ornament style desk: the preview the editor stylizes from, and in the viewer the clustering
 * the reconstruction made, at the tolerances of its own call, with nothing left that would make
 * another.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alignment } from '../../fitting/alignment';
import {
  createMpm,
  fillInAt,
  FrameDomain,
  type InstructionOptions,
  type Mpm,
  requireMap,
  setOrnamentDraft,
} from '../../fitting/instructions/index';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import type { Call } from '../../model/Work';
import { OrnamentationStyles } from './OrnamentationStyles';

interface DeskOptions {
    /** False for the viewer. */
    editable?: boolean;
    calls?: Call[];
    mpm?: Mpm;
    /** The document as the style call found it, where the chain holds one. */
    found?: Mpm | null;
}

const renderDesk = ({ editable = true, calls = [], mpm = createMpm(), found }: DeskOptions = {}) => {
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
                    <OrnamentationStyles
                        part='global'
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

    return { addTransformer, points: () => container.querySelectorAll('circle').length };
};

/**
 * Rolled chords as the fitters leave them: an `<ornament>` per chord, the frame parked on its
 * element for the style call to collect. Two with one frame, which share a definition at any
 * tolerance, and a third far from both.
 */
const fitted = (frameDomain = FrameDomain.Ticks) => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'ornament', 'global');
    [
        { date: 0, frameStart: -90, frameLength: 90 },
        { date: 720, frameStart: -90, frameLength: 90 },
        { date: 1440, frameStart: 0, frameLength: 300 },
    ].forEach(({ date, ...frame }) => {
        const options: InstructionOptions<'ornament'> = {
            id: `ornament_${date}`,
            date,
            nameRef: 'neutralArpeggio',
            scale: 0,
        };
        const element = fillInAt(map, options, {
            localName: 'ornament',
            add: (o) => map.addOrnamentV3(o),
            read: (i) => map.getOrnamentOptionsOf(i),
            update: (i, patch) => map.updateOrnamentAt(i, patch),
        });
        setOrnamentDraft(element, { ...frame, frameDomain });
    });
    return mpm;
};

const style: Call = {
    id: 'style',
    name: 'StylizeOrnamentation',
    options: { tickTolerance: 25, intensityTolerance: 0.5, gradientTolerance: 0.3 },
};

describe('the ornament style desk', () => {
    it('offers the button and the tolerances in the editor', () => {
        renderDesk();

        expect(screen.getByRole('button', { name: 'Stylize Ornaments' })).toBeInTheDocument();
        expect(screen.getAllByRole('slider')).toHaveLength(3);
    });

    it('offers neither in the viewer, and states the tolerances the chain stylized with', () => {
        renderDesk({ editable: false, calls: [style] });

        expect(screen.queryByRole('button', { name: 'Stylize Ornaments' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove Style' })).toBeNull();
        expect(screen.queryAllByRole('slider')).toHaveLength(0);
        expect(
            screen.getByText(/frame within 25 ticks, intensity within 0.5, gradient within 0.3/),
        ).toBeInTheDocument();
    });

    it('says so in the viewer where the chain stylizes nothing', () => {
        renderDesk({ editable: false });

        expect(screen.getByText(/does not stylize its ornaments/)).toBeInTheDocument();
    });
});

describe('the plot', () => {
    it('previews the fitted ornaments before anything is stylized', () => {
        const { points } = renderDesk({ mpm: fitted() });

        expect(points()).toBe(3);
        expect(screen.getByText('3 ornaments → 2 definitions')).toBeInTheDocument();
    });

    /**
     * The reconstruction's own state. The call has moved every frame into a definition, so the
     * finished document holds no ornament to place, and plotted over it the desk said "0
     * ornaments → 0 definitions" over 97 fitted spreads.
     */
    it('draws the ornaments as the style call found them, once it has cleared them', () => {
        const { points } = renderDesk({
            editable: false,
            calls: [style],
            mpm: createMpm(),
            found: fitted(),
        });

        expect(points()).toBe(3);
        expect(screen.getByText('3 ornaments → 2 definitions')).toBeInTheDocument();
    });

    it('labels the frames in the unit they are in', () => {
        renderDesk({ mpm: fitted(FrameDomain.Milliseconds) });
        expect(screen.getByText('frameLength (ms)')).toBeInTheDocument();
    });

    it('labels them ticks once the hinge has translated them, as in every chain', () => {
        renderDesk({ mpm: fitted() });
        expect(screen.getByText('frameLength (ticks)')).toBeInTheDocument();
    });
});

describe('in the editor, once stylized', () => {
    /**
     * The colours are then the definitions the call wrote. Sliders left live would recolour the
     * plot into a clustering nobody made, with Stylize dead and nothing to write it with.
     */
    it('holds the tolerances at the call, and leaves Remove Style to free them', () => {
        renderDesk({ calls: [style], found: fitted() });

        expect(screen.getByRole('button', { name: 'Stylize Ornaments' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove Style' })).toBeEnabled();
        const sliders = screen.getAllByRole('slider');
        expect(sliders.map((slider) => slider.getAttribute('aria-valuenow'))).toEqual([
            '25',
            '0.5',
            '0.3',
        ]);
        sliders.forEach((slider) => {
            expect(slider).toBeDisabled();
        });
    });
});
