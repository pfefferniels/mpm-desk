/**
 * The dynamics desk in its two modes: the editor draws a curve by dragging between two dots, the
 * viewer only reads — and in both, selecting a curve marks the dots it was fitted over.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import type { CallOutcome } from '../../fitting/fit';
import { createMpm, requireMap, type Mpm } from '../../fitting/instructions/index';
import { InsertDynamics } from '../../fitting/transformers/dynamics/InsertDynamics';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { DynamicsDesk } from './DynamicsDesk';

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
    mpm?: Mpm;
    /** The velocities of the four chords, a quarter apart from date 0. */
    velocities?: [number, number, number, number];
}

const mount = ({
    editable = true,
    outcomes = [],
    active = new Set(),
    mpm = createMpm(),
    velocities = [64, 74, 54, 68],
}: MountOptions = {}) => {
    const msm = new Alignment(
        (['a', 'b', 'c', 'd'] as const).map((id, i) => note(id, i * 720, velocities[i]!)),
    );
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
                                    mpm={mpm}
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

        const sent = addTransformer.mock.calls[0]![0] as InsertDynamics;
        expect(sent).toBeInstanceOf(InsertDynamics);
        expect(sent.options).toMatchObject({ from: 0, to: 1440, scope: 'global' });
    });
});

describe('in the viewer', () => {
    it('offers no control that writes, and a drag draws nothing', () => {
        const { addTransformer } = mount({ editable: false });

        expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Guide' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear Guides' })).toBeNull();

        drag(0, 1440);

        expect(addTransformer).not.toHaveBeenCalled();
        expect(dotAt(0)).not.toHaveStyle({ cursor: 'crosshair' });
    });
});

describe('the curves', () => {
    it('draws one for each <dynamics> something follows, each known to React by its own key', () => {
        const mpm = createMpm();
        const map = requireMap(mpm, 'dynamics', 'global');
        map.addDynamics({ id: 'd1', date: 0, volume: 64, transitionTo: 54 });
        map.addDynamics({ id: 'd2', date: 1440, volume: 54, transitionTo: 68 });
        map.addDynamics({ id: 'd3', date: 2160, volume: 68 });

        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            mount({ mpm });
            expect(document.querySelectorAll('g.curveSegment')).toHaveLength(2);
            expect(error.mock.calls.flat().join(' ')).not.toMatch(/unique "key"/);
        } finally {
            error.mockRestore();
        }
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

/** The velocities the scale labels, and where it puts each one. */
const ticks = () =>
    new Map(
        [...document.querySelectorAll('svg text')]
            .filter((label) => /^\d+$/.test(label.textContent))
            .map((label) => [Number(label.textContent), Number(label.getAttribute('y'))]),
    );

describe('what the plot shows', () => {
    /**
     * WM 225 was recorded between 35 and 62, and `Modify` took its softest notes down to 8. The
     * plot drew velocity 127 at its head and 20 at its foot whatever it held, and 59 of its 430
     * dots went below the foot.
     */
    it('draws every chord inside the plot, the softest and the loudest', () => {
        mount({ editable: false, velocities: [8, 35, 62, 120] });

        const plot = dotAt(0).closest('svg')!;
        const height = Number(plot.getAttribute('height'));
        for (const dot of plot.querySelectorAll('circle')) {
            expect(Number(dot.getAttribute('cy'))).toBeGreaterThan(0);
            expect(Number(dot.getAttribute('cy'))).toBeLessThan(height);
        }

        // And the scale labels what is drawn, rather than a stretch chosen in advance.
        const labelled = [...ticks().keys()];
        expect(Math.min(...labelled)).toBeLessThanOrEqual(8);
        expect(Math.max(...labelled)).toBeGreaterThanOrEqual(120);
    });
});

describe('pencilling in a guide', () => {
    it('puts it at the velocity under the pointer, as the scale reads it, and ↑ raises it a step', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Guide' }));

        const at = ticks();
        const plot = dotAt(0).closest('svg')!;
        fireEvent.click(plot, { clientX: 1440 * STRETCH_X, clientY: at.get(60)! });

        const guide = () => {
            const marks = [...plot.querySelectorAll('text')].filter((text) => text.textContent === 'x');
            expect(marks).toHaveLength(1);
            return Number(marks[0]!.getAttribute('y'));
        };
        expect(guide()).toBeCloseTo(at.get(60)!);

        fireEvent.keyDown(window, { key: 'ArrowUp' });
        expect(guide()).toBeCloseTo(at.get(60)! - (at.get(60)! - at.get(65)!) / 5);
    });
});
