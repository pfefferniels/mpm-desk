import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm } from '../../fitting/instructions/index';
import { InsertMetricalAccentuation } from '../../fitting/transformers/accentuation/InsertMetricalAccentuation';
import type { Residual } from '../../fitting/residual';
import { AccentuationDesk } from './AccentuationDesk';

/** The plot sounds a chord as the pointer passes it, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

/**
 * An identity screen matrix, which jsdom has no notion of.
 *
 * Every gesture on the plot goes through `svgPoint`, and `svgPoint` answers `null` where there is
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

const alignment = () =>
    new Alignment([
        note('a', 0, 64),
        note('b', 720, 74),
        note('c', 1440, 54),
        note('d', 2160, 68),
    ]);

/**
 * A recording that is louder and softer than the MPM renders it, note by note.
 *
 * The plot draws a dot only where the residual has a velocity — an unmeasurable note is not a
 * zero — so a stub answering `undefined` would draw an empty plot with nothing to mark a range
 * between. What the fit made of the loudness is not this file's subject; where a gesture lands is.
 */
const residual = (): Residual => ({
    of: (note) => ({
        note,
        tickDate: note.date,
        tickDuration: note.duration,
        velocity: note.velocity - 64,
        renderedVelocity: 64,
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
                            <AccentuationDesk
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

/** The plot's hit surface, which every gesture below is aimed at rather than at a dot on it. */
const surface = () => {
    const rect = document.querySelector('svg.accentuationPlot rect.pickSurface');
    if (!rect) throw new Error('no pick surface');
    return rect;
};

/** The dot the plot draws for a chord, found by the date it is stamped with. */
const dotAt = (date: number) => {
    const dot = document.querySelector(`circle[data-date="${String(date)}"]`);
    if (!dot) throw new Error(`no dot at date ${String(date)}`);
    return dot;
};

/** A client x, which under the identity CTM is a user x — so `date * STRETCH_X`. */
const at = (date: number) => date * STRETCH_X;

const pointAt = (
    clientX: number,
    type: 'click' | 'mousemove',
    { on = surface(), ...modifiers }: MouseEventInit & { on?: Element } = {},
) => {
    act(() => {
        on.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY: 100, ...modifiers }));
    });
};

const pressEscape = () => {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
};

const pending = () => document.querySelector('g.pendingCandidate');
const closed = () => document.querySelector('polygon.accentuationPreview');
const insertButton = () => screen.getByRole('button', { name: 'Insert' });

/** What the pending candidate says it covers, in ticks. */
const pendingLength = () => document.querySelector('g.pendingCandidate text')?.textContent;

describe('marking a candidate', () => {
    it('opens one at the nearest dot, wherever in its column the click lands', () => {
        mount();

        // Nearer the dot at 1440 than to the one at 720, and nowhere near either vertically.
        pointAt(at(1300), 'click');

        expect(pending()?.querySelector('line')?.getAttribute('x1')).toBe(String(at(1440)));
        expect(insertButton()).toBeDisabled();
    });

    it('follows the cursor until the second click', () => {
        mount();

        pointAt(at(0), 'click');
        pointAt(at(700), 'mousemove');

        expect(pendingLength()).toBe('720');

        pointAt(at(1500), 'mousemove');

        expect(pendingLength()).toBe('1440');
    });

    it('keeps following where the pointer crosses a dot', () => {
        mount();

        pointAt(at(0), 'click');
        pointAt(at(2160), 'mousemove', { on: dotAt(2160) });

        expect(pendingLength()).toBe('2160');
    });

    it('closes on the second click, and stops following', () => {
        mount();

        pointAt(at(0), 'click');
        pointAt(at(720), 'click');
        pointAt(at(2160), 'mousemove');

        expect(pending()).toBeNull();
        expect(closed()).not.toBeNull();
        expect(insertButton()).toBeEnabled();
    });

    it('marks the same stretch drawn backwards', () => {
        const { addTransformer } = mount();

        pointAt(at(2160), 'click');
        pointAt(at(0), 'click');

        act(() => {
            insertButton().click();
        });
        // The dialog's own Insert. The toolbar's is behind a modal by now, and so out of the
        // accessible tree — which is what leaves this name unambiguous.
        act(() => {
            screen.getByRole('button', { name: 'Insert' }).click();
        });

        const sent = addTransformer.mock.calls[0][0] as InsertMetricalAccentuation;
        expect(sent).toBeInstanceOf(InsertMetricalAccentuation);
        expect(sent.options).toMatchObject({ scope: 'global', from: 0, to: 2160 });
    });

    it('takes a third click as the start of a new one', () => {
        mount();

        pointAt(at(0), 'click');
        pointAt(at(720), 'click');
        pointAt(at(2160), 'click');

        expect(pending()?.querySelector('line')?.getAttribute('x1')).toBe(String(at(2160)));
        expect(insertButton()).toBeDisabled();
    });

    it('reaches backwards on a shift-click without inverting the range', () => {
        mount();

        pointAt(at(1440), 'click');
        pointAt(at(2160), 'click');
        pointAt(at(0), 'click', { shiftKey: true });

        expect(insertButton()).toBeEnabled();
        // 0 to 2160: the far end held, the near one moved. An inverted range draws nothing.
        expect(closed()?.getAttribute('points')).toContain(`${String(at(0))},`);
    });

    it('drops the candidate on Escape', () => {
        mount();

        pointAt(at(0), 'click');
        pressEscape();

        expect(pending()).toBeNull();
        expect(closed()).toBeNull();
    });
});
