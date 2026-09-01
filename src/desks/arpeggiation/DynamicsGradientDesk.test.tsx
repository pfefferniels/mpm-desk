import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { convertMeiToMsm } from 'espressivo';
import { Alignment } from '../../fitting/alignment';
import { asMSM } from '../../fitting/asMSM';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm } from '../../fitting/instructions/index';
import type { Scope } from '../../fitting/instructions/index';
import { deriveResidual } from '../../fitting/residual';
import { DynamicsGradientDesk } from './DynamicsGradientDesk';

/** Hovering a chord sounds it, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

/**
 * The shipped transcription on one reading, as in `ArticulationDesk.test.tsx` — `asMSM` makes a
 * note per `<when>`, and a desk only ever sees a score `MakeChoice` has run over.
 */
let msm: Alignment;

beforeAll(() => {
    const mei = readFileSync('public/transcription.mei', 'utf-8');
    const takes = asMSM(mei, convertMeiToMsm(mei)[0]!.msm);
    const [preferred] = takes.sources();
    msm = new Alignment(
        takes.allNotes.filter((note) => note.source === preferred),
        takes.timeSignatures,
    );
});

const renderDesk = (part: Scope) => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const mpm = createMpm();
    const { unmount } = render(
        <ZoomContext
            value={{ symbolic: { stretchX: 0.1 }, physical: { stretchX: 20 }, setStretchX: vi.fn() }}
        >
            <NotesProvider notes={msm.allNotes}>
                <ScrollSyncProvider
                    symbolicZoom={0.1}
                    physicalZoom={20}
                    tickToSeconds={(tick) => tick / 1440}
                    secondsToTick={(seconds) => seconds * 1440}
                >
                    <CallSelectionProvider
                        calls={[]}
                        outcomes={[]}
                        activeCallIds={new Set()}
                        setActiveCallIds={vi.fn()}
                        onRemoveCalls={vi.fn()}
                        focusCall={vi.fn()}
                    >
                        <DeskToolbarProvider target={bar}>
                            <DynamicsGradientDesk
                                part={part}
                                msm={msm}
                                mpm={mpm}
                                residual={deriveResidual(msm, mpm)}
                                projected={[]}
                                performanceXml=""
                                secondary={{}}
                                setSecondary={vi.fn()}
                                addTransformer={vi.fn()}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </NotesProvider>
        </ZoomContext>,
    );

    return {
        /** One group per chord whose ramp is still to be drawn, which with an empty MPM is all of them. */
        chords: () => document.querySelectorAll('svg g[data-date]'),
        /** The hull, one quadrilateral joining each chord to the next. */
        hull: () => document.querySelectorAll('svg polygon'),
        dispose: () => {
            unmount();
            bar.remove();
        },
    };
};

describe('what the dynamics gradient desk plots', () => {
    it('draws the chords of the scope on the picker, and no others', () => {
        const inScope = (part: Scope) => {
            const desk = renderDesk(part);
            const counts = { chords: desk.chords().length, hull: desk.hull().length };
            desk.dispose();
            return counts;
        };

        // The two parts together hold more chords than the score does, because 100 of the 215
        // carry notes from both. Drawn globally, either part would draw all 215.
        expect(msm.in('global').chords()).toHaveProperty('size', 215);
        expect(msm.in(0).chords()).toHaveProperty('size', 183);
        expect(msm.in(1).chords()).toHaveProperty('size', 132);

        // The hull joins consecutive chords, so it is one short of them wherever the two agree.
        // Where they did not, the ramps drawn were the extremes of chords the hull never covered.
        expect(inScope('global')).toEqual({ chords: 215, hull: 214 });
        expect(inScope(0)).toEqual({ chords: 183, hull: 182 });
        expect(inScope(1)).toEqual({ chords: 132, hull: 131 });
    });
});
