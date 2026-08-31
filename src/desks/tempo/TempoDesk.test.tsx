import { describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { InsertTempo } from '../../fitting/transformers/tempo/InsertTempo';
import { scopeData } from './secondary';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm, requireMap } from '../../fitting/instructions/index';
import type { Mpm } from '../../fitting/instructions/index';
import { deriveResidual } from '../../fitting/residual';
import type { Scope } from '../../fitting/instructions/index';
import type { SecondaryData } from '../TransformerViewProps';
import { TempoDesk } from './TempoDesk';

/** The skyline hovers a box to audition it, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

const note = (id: string, date: number, part: number, seconds: number): AlignedNote => ({
    'xml:id': id,
    part,
    staff: String(part),
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': seconds * 1000,
    'milliseconds.date.end': seconds * 1000 + 500,
    'midi.pitch': 60,
    velocity: 64,
});

/**
 * Two parts that do not play alike: part one on every quarter, part two on every half.
 *
 * Part two's dates are a subset of part one's, so a desk that ignores the scope draws part one's
 * boxes under either choice — which is the whole subject of this file.
 */
const alignment = () =>
    new Alignment([
        note('a1', 0, 1, 0),
        note('a2', 720, 1, 0.5),
        note('a3', 1440, 1, 1),
        note('a4', 2160, 1, 1.5),
        note('b1', 0, 2, 0),
        note('b2', 1440, 2, 1),
    ]);

/**
 * The desk under the five contexts it reads, with its own `secondary` held as state.
 *
 * Holding it is what lets a test watch the desk edit it — which for the drawn curves is the whole
 * behaviour: they are written at one click and dropped at a later fit.
 */
const Desk = ({
    part,
    mpm,
    initial = {},
    bar,
    addTransformer = vi.fn(),
}: {
    part: Scope;
    mpm: Mpm;
    initial?: SecondaryData;
    bar: HTMLElement;
    addTransformer?: (transformer: InsertTempo) => void;
}) => {
    const msm = useMemo(() => alignment(), []);
    const [secondary, setSecondary] = useState(initial);

    return (
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
                            <span data-testid="drawn">
                                {scopeData(secondary.tempo, part).drawnLines?.length ?? 0}
                            </span>
                            <TempoDesk
                                part={part}
                                msm={msm}
                                mpm={mpm}
                                residual={deriveResidual(msm, mpm)}
                                projected={[]}
                                performanceXml=""
                                secondary={secondary}
                                setSecondary={setSecondary}
                                addTransformer={addTransformer}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </NotesProvider>
        </ZoomContext>
    );
};

const renderDesk = (part: Scope, secondary: SecondaryData = {}, mpm: Mpm = createMpm()) => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    const addTransformer = vi.fn();

    const { rerender, unmount } = render(
        <Desk part={part} mpm={mpm} initial={secondary} bar={bar} addTransformer={addTransformer} />,
    );

    return {
        bar,
        addTransformer,
        /** The curves the skyline is drawing, against the ones the work file still holds. */
        drawn: () => document.querySelectorAll('g.drawnLine'),
        drawnLines: () => Number(screen.getByTestId('drawn').textContent),
        /** The next fit landing: the chain's answer is a new document every time. */
        fit: (next: Mpm) =>
            rerender(
                <Desk
                    part={part}
                    mpm={next}
                    initial={secondary}
                    bar={bar}
                    addTransformer={addTransformer}
                />,
            ),
        dispose: () => {
            unmount();
            bar.remove();
        },
    };
};

const mount = (part: Scope, secondary: SecondaryData = {}) => {
    const { dispose } = renderDesk(part, secondary);
    const boxes = [...document.querySelectorAll('polygon.box')].map((box) => ({
        start: Number(box.getAttribute('data-start')),
        length: Number(box.getAttribute('data-length')),
    }));
    dispose();
    return boxes.sort((a, b) => a.start - b.start);
};

describe('the skyline follows the scope', () => {
    it('seeds its boxes from the selected part alone', () => {
        expect(mount(0)).toEqual([
            { start: 0, length: 720 },
            { start: 720, length: 720 },
            { start: 1440, length: 720 },
            { start: 2160, length: 720 },
        ]);

        // Two boxes, not one: the last chord of a part is bounded by its own longest note
        // rather than by a next onset, which is `extractTempoSegments`'s closing case.
        expect(mount(1)).toEqual([
            { start: 0, length: 1440 },
            { start: 1440, length: 720 },
        ]);
    });

    it('does not hand a part the boxes a pre-scope file stored', () => {
        // The shape `latest/work.json` carries: one undivided bag, written when every edit was
        // made under Global. Before this it was preferred over the seed in every scope, so the
        // picker changed the skyline not at all.
        const stored: SecondaryData = {
            tempo: { tempoCluster: [{ date: { start: 0, end: 2880 }, selected: false, silent: false }] },
        };

        expect(mount('global', stored)).toEqual([{ start: 0, length: 2880 }]);
        expect(mount(1, stored)).toEqual([
            { start: 0, length: 1440 },
            { start: 1440, length: 720 },
        ]);
    });
});

const withOneTempo = () => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 0).addTempo({ date: 0, bpm: 90, beatLength: 0.25, id: 't1' });
    return mpm;
};

const oneDrawnLine: SecondaryData = {
    tempo: {
        byScope: {
            '0': {
                drawnLines: [
                    {
                        from: { seconds: 0.5, bpm: 90 },
                        to: { seconds: 1, bpm: 120 },
                        meanTempoAt: 0.5,
                        beatLength: 0.25,
                        startTick: 720,
                        endTick: 1440,
                    },
                ],
            },
        },
    },
};

describe('what the skyline draws in draw mode', () => {
    it('keeps the written tempo curves on screen', () => {
        // Insert leaves the mode as it found it, so the curve the click wrote would be drawn
        // under Draw or not at all.
        const { bar, dispose } = renderDesk(0, {}, withOneTempo());
        expect(document.querySelectorAll('g.tempoLine')).toHaveLength(1);

        fireEvent.click(within(bar).getByRole('button', { name: 'Draw' }));
        expect(document.querySelectorAll('g.tempoLine')).toHaveLength(1);
        dispose();
    });

    it('does not restate a drawn curve as a tempo line', () => {
        const { bar, dispose } = renderDesk(0, oneDrawnLine, withOneTempo());
        fireEvent.click(within(bar).getByRole('button', { name: 'Draw' }));

        // The blue polyline the stroke left is on screen already; the preview of what it will
        // become is the other mode's reading.
        expect(document.querySelectorAll('g.tempoLine')).toHaveLength(1);
        dispose();
    });
});

describe('inserting the drawn curves', () => {
    /** The fit the click asks for: the drawn curve, as the chain writes it. */
    const withTheDrawnTempo = () => {
        const mpm = withOneTempo();
        requireMap(mpm, 'tempo', 0).addTempo({
            date: 720,
            bpm: 90,
            transitionTo: 120,
            meanTempoAt: 0.5,
            beatLength: 0.25,
            id: 't2',
        });
        return mpm;
    };

    it('keeps the curve on the skyline until the fit carrying it lands', () => {
        const { bar, addTransformer, drawn, drawnLines, fit, dispose } = renderDesk(
            0,
            oneDrawnLine,
            withOneTempo(),
        );
        expect(drawn()).toHaveLength(1);

        fireEvent.click(within(bar).getByRole('button', { name: 'Insert' }));
        expect(addTransformer).toHaveBeenCalledTimes(1);
        expect(addTransformer.mock.calls[0][0]).toBeInstanceOf(InsertTempo);

        // The chain owns the curve now and the work file says so, but the fold takes seconds and
        // the skyline has nothing else to show for it yet.
        expect(drawnLines()).toBe(0);
        expect(drawn()).toHaveLength(1);

        fit(withTheDrawnTempo());
        expect(drawn()).toHaveLength(0);
        expect(document.querySelectorAll('g.tempoLine')).toHaveLength(2);
        dispose();
    });

    it('keeps it where the chain answers nothing', () => {
        const mpm = withOneTempo();
        const { bar, drawn, fit, dispose } = renderDesk(0, oneDrawnLine, mpm);

        fireEvent.click(within(bar).getByRole('button', { name: 'Insert' }));
        // A refused chain hands back no new document, and a curve that was not written stays.
        fit(mpm);
        expect(drawn()).toHaveLength(1);
        dispose();
    });
});
