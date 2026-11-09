/**
 * The dynamics desk in its two modes: the editor draws a curve by dragging between two dots, the
 * viewer only reads — and in both, selecting a curve marks the dots it was fitted over.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import type { CallOutcome } from '../../fitting/fit';
import { createMpm } from '../../fitting/instructions/index';
import { InsertDynamicsInstructions } from '../../fitting/transformers/dynamics/InsertDynamicsInstructions';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { DynamicsDesk } from './DynamicsDesk';

/** Hovering a dot sounds its chord, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

/**
 * An identity screen matrix, which jsdom has no notion of — see the same stub in
 * `AccentuationDesk.test.tsx`. With it a client coordinate is a user coordinate, so the drag below
 * is aimed at `date * STRETCH_X`.
 */
beforeAll(() => {
    const identity = { a: 1, inverse: () => identity };
    const proto = SVGSVGElement.prototype as unknown as {
        getScreenCTM: () => unknown;
        createSVGPoint: () => unknown;
    };
    proto.getScreenCTM = () => identity;
    proto.createSVGPoint = () => {
        const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) };
        return point;
    };
});

const STRETCH_X = 0.1;

const note = (id: string, date: number, velocity: number): AlignedNote => ({
    'xml:id': id,
    part: 1,
    staff: '1',
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': date,
    'milliseconds.date.end': date + 500,
    'midi.pitch': 60,
    velocity,
});

interface MountOptions {
    /** False for the viewer. */
    editable?: boolean;
    /** What the last fit reported per call, and which calls are selected. */
    outcomes?: CallOutcome[];
    active?: Set<string>;
}

const mount = ({ editable = true, outcomes = [], active = new Set() }: MountOptions = {}) => {
    const msm = new Alignment([
        note('a', 0, 64),
        note('b', 720, 74),
        note('c', 1440, 54),
        note('d', 2160, 68),
    ]);
    const addTransformer = vi.fn();

    // The app bar's second row. A desk under a null target renders no toolbar at all, so without
    // this the absence of the controls in the viewer would prove nothing.
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    render(
        <EditingContext value={editable}>
            <ZoomContext
                value={{
                    symbolic: { stretchX: STRETCH_X },
                    physical: { stretchX: 20 },
                    setStretchX: vi.fn(),
                }}
            >
                <NotesProvider notes={msm.allNotes}>
                    <ScrollSyncProvider symbolicZoom={STRETCH_X}>
                        <CallSelectionProvider
                            calls={[]}
                            outcomes={outcomes}
                            activeCallIds={active}
                            setActiveCallIds={vi.fn()}
                            onRemoveCalls={vi.fn()}
                            focusCall={vi.fn()}
                        >
                            <DeskToolbarProvider target={bar}>
                                <DynamicsDesk
                                    part='global'
                                    msm={msm}
                                    mpm={createMpm()}
                                    residual={null}
                                    performanceXml=''
                                    secondary={{}}
                                    setSecondary={vi.fn()}
                                    addTransformer={addTransformer}
                                />
                            </DeskToolbarProvider>
                        </CallSelectionProvider>
                    </ScrollSyncProvider>
                </NotesProvider>
            </ZoomContext>
        </EditingContext>,
    );

    return { addTransformer };
};

/** The dot the plot draws for a chord, found by the date it is stamped with. */
const dotAt = (date: number) => {
    const dot = document.querySelector(`circle[data-date="${String(date)}"]`);
    if (!dot) throw new Error(`no dot at date ${String(date)}`);
    return dot;
};

/** Press on the plot at one date, move to another, and let go. */
const drag = (from: number, to: number) => {
    const plot = dotAt(0).closest('svg')!;
    fireEvent.mouseDown(plot, { clientX: from * STRETCH_X, clientY: 100 });
    fireEvent.mouseMove(plot, { clientX: to * STRETCH_X, clientY: 100 });
    fireEvent.mouseUp(plot, { clientX: to * STRETCH_X, clientY: 100 });
};

describe('drawing a curve', () => {
    it('writes one between the two dots a drag runs between', () => {
        const { addTransformer } = mount();

        drag(0, 1440);

        const sent = addTransformer.mock.calls[0]![0] as InsertDynamicsInstructions;
        expect(sent).toBeInstanceOf(InsertDynamicsInstructions);
        expect(sent.options).toMatchObject({ from: 0, to: 1440, scope: 'global' });
    });
});

describe('in the viewer', () => {
    it('offers no control that writes, and a drag draws nothing', () => {
        const { addTransformer } = mount({ editable: false });

        expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Phantom' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear Phantoms' })).toBeNull();

        drag(0, 1440);

        expect(addTransformer).not.toHaveBeenCalled();
        expect(dotAt(0)).not.toHaveStyle({ cursor: 'crosshair' });
    });
});

describe('what a selected curve was fitted to', () => {
    it('marks the chords over its range, and no others', () => {
        mount({
            editable: false,
            outcomes: [
                { id: 'curve', elements: [], range: { from: 720, to: 1440 }, evidence: ['b', 'c'] },
            ],
            active: new Set(['curve']),
        });

        expect(dotAt(720)).toHaveAttribute('data-evidence');
        expect(dotAt(1440)).toHaveAttribute('data-evidence');
        expect(dotAt(0)).not.toHaveAttribute('data-evidence');
        expect(dotAt(2160)).not.toHaveAttribute('data-evidence');
    });
});
