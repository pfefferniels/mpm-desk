import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm } from '../../fitting/instructions/index';
import { InsertRubato } from '../../fitting/transformers/rubato/InsertRubato';
import type { Residual } from '../../fitting/residual';
import { RubatoDesk } from './RubatoDesk';

/** The row auditions a date as the pointer passes it, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

/**
 * An identity screen matrix, which jsdom has no notion of.
 *
 * Every gesture on the row goes through `svgPoint`, and `svgPoint` answers `null` where there is
 * no CTM. Under jsdom that is always, so without this stub no click in this file could name a
 * date. Identity means a client coordinate is a user coordinate, which keeps the arithmetic in
 * the assertions readable.
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

const note = (id: string, date: number): AlignedNote => ({
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
    velocity: 64,
});

/** Quarters, so the eighth-note grid rules a line between every pair of them. */
const alignment = () =>
    new Alignment([note('a', 0), note('b', 720), note('c', 1440), note('d', 2160)]);

/**
 * The recording landing exactly on the score grid.
 *
 * The row draws a note only where the residual has a tick date for it, so a stub that answers
 * `undefined` — which is what deriving one against an MPM with no tempoMap gives — would draw an
 * empty row. What the fit made of the timing is not this file's subject; where a click lands is.
 */
const residual = (): Residual => ({
    of: (note) => ({
        note,
        tickDate: note.date,
        tickDuration: note.duration,
        velocity: 0,
        renderedVelocity: note.velocity,
    }),
    ofPedal: () => undefined,
    notes: [],
    pedals: [],
});

const mount = () => {
    const msm = alignment();
    const addTransformer = vi.fn();

    // The app bar's second row, standing in for `EditorAppBar`'s. A desk under a null target
    // renders no toolbar at all, so without this the controls under test are simply absent.
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    render(
        <ZoomContext
            value={{
                symbolic: { stretchX: STRETCH_X },
                physical: { stretchX: 20 },
                setStretchX: vi.fn(),
            }}
        >
            <NotesProvider notes={msm.allNotes}>
                <ScrollSyncProvider
                    symbolicZoom={STRETCH_X}
                    physicalZoom={20}
                    tickToSeconds={(tick) => tick / 720}
                    secondsToTick={(seconds) => seconds * 720}
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
                            <RubatoDesk
                                part='global'
                                msm={msm}
                                mpm={createMpm()}
                                residual={residual()}
                                projected={[]}
                                performanceXml=''
                                secondary={{}}
                                setSecondary={vi.fn()}
                                addTransformer={addTransformer}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </NotesProvider>
        </ZoomContext>,
    );

    return { addTransformer };
};

/** The row's hit surface, which every gesture below is aimed at rather than at a mark on it. */
const surface = () => {
    const rect = document.querySelector('rect.pickSurface');
    if (!rect) throw new Error('no pick surface');
    return rect;
};

/** A client x, which under the identity CTM is a user x — so `date * STRETCH_X`. */
const at = (date: number) => date * STRETCH_X;

const pointAt = (clientX: number, type: 'click' | 'mousemove') => {
    act(() => {
        surface().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY: 20 }));
    });
};

const pendingBox = () => document.querySelector('g.pendingFrame rect');

const insertButton = () => screen.getByRole('button', { name: 'Insert' });

describe('marking a frame', () => {
    it('picks the nearest grid date where no note sounds', () => {
        mount();

        // Between the notes at 0 and 720, nearer the grid line at 360 than to either of them.
        pointAt(at(400), 'click');

        expect(pendingBox()).toBeNull();
        expect(document.querySelector('g.pendingFrame line')?.getAttribute('x1'))
            .toBe(String(at(360)));
    });

    it('follows the cursor between the two clicks', () => {
        mount();

        pointAt(at(400), 'click');
        pointAt(at(1120), 'mousemove');

        const box = pendingBox();
        expect(box?.getAttribute('x')).toBe(String(at(360)));
        // 1120 is nearest the grid line at 1080, which is 720 ticks past the anchor.
        expect(box?.getAttribute('width')).toBe(String(at(720)));
    });

    it('sends the frame the preview drew', () => {
        const { addTransformer } = mount();

        pointAt(at(400), 'click');
        pointAt(at(1120), 'mousemove');
        pointAt(at(1120), 'click');

        act(() => {
            insertButton().click();
        });

        expect(addTransformer).toHaveBeenCalledTimes(1);
        const sent = addTransformer.mock.calls[0][0] as InsertRubato;
        expect(sent).toBeInstanceOf(InsertRubato);
        expect(sent.options).toMatchObject({ scope: 'global', date: 360, length: 720 });
    });

    it('reads a second click before the first as the frame’s start', () => {
        const { addTransformer } = mount();

        pointAt(at(1120), 'click');
        pointAt(at(400), 'click');

        act(() => {
            insertButton().click();
        });

        expect(addTransformer.mock.calls[0][0].options).toMatchObject({ date: 360, length: 720 });
    });

    it('takes a third click as the start of a new frame', () => {
        mount();

        pointAt(at(0), 'click');
        pointAt(at(720), 'click');
        pointAt(at(1440), 'click');

        expect(insertButton()).toBeDisabled();
        expect(document.querySelector('g.pendingFrame line')?.getAttribute('x1'))
            .toBe(String(at(1440)));
    });
});
