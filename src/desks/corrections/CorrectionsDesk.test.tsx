import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../fitting/alignment';
import type { Call } from '../../model/Work';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { NotesProvider } from '../../hooks/NotesProvider';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { createMpm } from '../../fitting/instructions/index';
import { deriveResidual } from '../../fitting/residual';
import { Modify } from '../../fitting/transformers/modification/Modify';
import { CorrectionsDesk } from './CorrectionsDesk';

/**
 * The desk, mounted.
 *
 * Not a screenshot in prose: what this checks is the one thing the hook tests below cannot, that
 * the two plots draw the recording and that a gesture on one of them turns into a `Modify` with
 * the right selector and the right aspect. The velocity plot auditions notes as the pointer
 * passes them, so the piano is stubbed — Tone in jsdom is a slow way to assert nothing.
 */

vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

/**
 * An identity screen matrix, which jsdom has no notion of.
 *
 * Every drag on either plot goes through `svgPoint`, and `svgPoint` answers `null` where there is
 * no CTM — deliberately, so a caller decides what to do rather than being handed a plausible
 * origin. Under jsdom that is *always*, so without this stub no drag in this file could travel a
 * single pixel. Identity means a client coordinate is a user coordinate, which keeps the
 * arithmetic in the assertions readable.
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

const note = (id: string, date: number, over: Partial<AlignedNote> = {}): AlignedNote => ({
    'xml:id': id,
    part: 1,
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': date,
    'milliseconds.date.end': date + 500,
    'midi.pitch': 60,
    velocity: 64,
    ...over,
});

const pedal = (id: string): AlignedPedal => ({
    'xml:id': id,
    type: 'sustain',
    'milliseconds.date': 0,
    'milliseconds.date.end': 2000,
});

const alignment = () => {
    const msm = new Alignment([note('a', 0), note('b', 720, { velocity: 80 })]);
    msm.pedals = [pedal('p1')];
    return msm;
};

/**
 * The desk under the providers it reads, with the editor's own answer to `addTransformer`.
 *
 * A sent call lands in the chain immediately — that is what `App` does, and the desk depends on
 * it: the correction it is optimistically drawing is held out of the ghosts by *matching* the
 * call now in `calls`. A spy that recorded the call and dropped it would leave the hold-out with
 * nothing to cancel, and the ghost would appear on the wrong side of the dot.
 *
 * `msm` deliberately does not change. The alignment is an output of the fit, which does not run
 * here, so the desk stays in the state it is in between sending a correction and being answered.
 */
const mount = (initialCalls: readonly Call[] = []) => {
    const msm = alignment();
    const mpm = createMpm();
    const addTransformer = vi.fn();

    // The app bar's second row, standing in for `EditorAppBar`'s. A desk under a null target
    // renders no toolbar at all, so without this the controls under test are simply absent.
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const Harness = () => {
        const [calls, setCalls] = useState<readonly Call[]>(initialCalls);

        return (
            <NotesProvider notes={msm.allNotes}>
                <ScrollSyncProvider
                    symbolicZoom={20}
                    physicalZoom={20}
                    tickToSeconds={(tick) => tick / 720}
                    secondsToTick={(seconds) => seconds * 720}
                >
                    <CallSelectionProvider
                        calls={calls}
                        outcomes={[]}
                        activeCallIds={new Set()}
                        setActiveCallIds={vi.fn()}
                        onRemoveCalls={vi.fn()}
                        focusCall={vi.fn()}
                    >
                        <DeskToolbarProvider target={bar}>
                            <CorrectionsDesk
                                part="global"
                                msm={msm}
                                mpm={mpm}
                                residual={deriveResidual(msm, mpm)}
                                projected={[]}
                                performanceXml=""
                                secondary={{}}
                                setSecondary={vi.fn()}
                                addTransformer={(transformer) => {
                                    addTransformer(transformer);
                                    setCalls((current) => [
                                        ...current,
                                        {
                                            id: transformer.id,
                                            name: transformer.name,
                                            options: transformer.options as unknown as Record<string, unknown>,
                                        },
                                    ]);
                                }}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </NotesProvider>
        );
    };

    render(<Harness />);

    return { msm, addTransformer };
};

/** The dot the velocity plot draws for a note, found by the date it is stamped with. */
const dotAt = (date: number) => {
    const dot = document.querySelector(`circle[data-date="${String(date)}"]`);
    if (!dot) throw new Error(`no dot at date ${String(date)}`);
    return dot;
};

/**
 * Press a dot, which is where both plots take their selection from.
 *
 * Not a click: a drag that ends off the dot fires no click on it, so selecting on the press is
 * the only way the same gesture can both name the notes and say how far they move.
 */
const pressDot = (date: number, modifiers: MouseEventInit = {}) => {
    act(() => {
        dotAt(date).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...modifiers }));
    });
};

const clickToolbarButton = (name: string) => {
    const button = screen.getByRole('button', { name });
    act(() => {
        button.click();
    });
    return button;
};

describe('the velocity plot', () => {
    it('draws a dot per recorded velocity', () => {
        mount();

        expect(document.querySelectorAll('circle[data-date]')).toHaveLength(2);
    });

    it('sends nothing until a selected dot has actually been dragged', () => {
        const { addTransformer } = mount();

        pressDot(0);

        expect(screen.getByText('1 note')).toBeInTheDocument();
        // Selected, but not moved — there is no correction to apply yet.
        expect(screen.getByRole('button', { name: 'Apply correction' })).toBeDisabled();
        expect(addTransformer).not.toHaveBeenCalled();
    });

    it('marks a velocity the chain already corrected', () => {
        mount([
            {
                id: 'c1',
                name: 'Modify',
                options: { scope: 'global', aspect: 'velocity', change: -3, noteIDs: ['a'] },
            },
        ]);

        // One ghost, drawn three velocity steps above the dot it belongs to.
        const ghosts = document.querySelectorAll('circle[fill="none"]');
        expect(ghosts).toHaveLength(1);
    });
});

describe('the timing roll', () => {
    const showRoll = () => {
        act(() => {
            screen.getByRole('button', { name: 'Timing' }).click();
        });
    };

    it('draws the notes and the pedal lanes', () => {
        mount();
        showRoll();

        expect(document.querySelectorAll('rect[data-id]')).toHaveLength(3);
        expect(document.querySelector('rect[data-type="sustain"]')).toBeInTheDocument();
        expect(screen.getByText('sustain')).toBeInTheDocument();
    });

    it('selects a pedal as a list of pedals, never as a stretch of the score', () => {
        // A recorded pedal has no symbolic date, so `from`/`to` cannot name one.
        mount();
        showRoll();

        const lane = document.querySelector('rect[data-type="sustain"]');
        act(() => {
            lane?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }));
        });

        expect(screen.getByText('1 pedal')).toBeInTheDocument();
    });
});

describe('the toolbar', () => {
    it('says what the selection covers and offers to forget it', () => {
        mount();

        expect(screen.getByText('nothing')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear selection' })).toBeDisabled();

        pressDot(720);
        expect(screen.getByText('1 note')).toBeInTheDocument();

        clickToolbarButton('Clear selection');
        expect(screen.getByText('nothing')).toBeInTheDocument();
    });

    it('has exactly one filled button, which is Apply', () => {
        // The bar's rule: one primary per desk, the thing the desk is for.
        mount();

        const filled = document.querySelectorAll('.MuiButton-contained');
        expect(filled).toHaveLength(1);
        expect(filled[0]).toHaveAccessibleName('Apply correction');
    });
});

/** Drag the element under the pointer from one client point to another, and let go. */
const drag = (
    from: Element,
    start: { clientX: number; clientY: number },
    end: { clientX: number; clientY: number },
) => {
    act(() => {
        from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...start }));
    });
    act(() => {
        from.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...end }));
    });
    act(() => {
        from.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...end }));
    });
};

/** The one `Modify` the desk sent, unwrapped. */
const sentOptions = (addTransformer: ReturnType<typeof vi.fn>) => {
    expect(addTransformer).toHaveBeenCalledTimes(1);
    const sent: unknown = addTransformer.mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(Modify);
    return (sent as Modify).options;
};

describe('what a gesture turns into', () => {
    it('a velocity drag becomes a Modify on the notes that were selected', () => {
        const { addTransformer } = mount();

        // Thirty user units up, at three units per velocity step.
        drag(dotAt(0), { clientX: 0, clientY: 100 }, { clientX: 0, clientY: 70 });

        expect(screen.getByText('+10')).toBeInTheDocument();
        clickToolbarButton('Apply correction');

        expect(sentOptions(addTransformer)).toEqual({
            noteIDs: ['a'],
            scope: 'global',
            aspect: 'velocity',
            change: 10,
        });
    });

    it('a drag on the body of a note on the roll becomes an onset correction', () => {
        const { addTransformer } = mount();
        act(() => {
            screen.getByRole('button', { name: 'Timing' }).click();
        });

        // 20 user units at a physical zoom of 20 is one second of recording.
        const body = document.querySelector('rect[data-id="b"]');
        if (!body) throw new Error('no note on the roll');
        drag(body, { clientX: 5, clientY: 5 }, { clientX: 25, clientY: 5 });

        expect(screen.getByText('+1000 ms')).toBeInTheDocument();
        clickToolbarButton('Apply correction');

        expect(sentOptions(addTransformer)).toEqual({
            noteIDs: ['b'],
            scope: 'global',
            aspect: 'onset',
            change: 1000,
        });
    });

    it('a stretch selected by shift-click is sent as a stretch, not as the notes it happens to hold', () => {
        // The three selector arms are what the user drew, not something derived from it: a range
        // re-resolves against whatever the alignment holds when the chain runs.
        const { addTransformer } = mount();

        pressDot(0);
        pressDot(720, { shiftKey: true });
        expect(screen.getByText('ticks 0–720')).toBeInTheDocument();

        drag(dotAt(0), { clientX: 0, clientY: 100 }, { clientX: 0, clientY: 109 });
        clickToolbarButton('Apply correction');

        expect(sentOptions(addTransformer)).toEqual({
            from: 0,
            to: 720,
            scope: 'global',
            aspect: 'velocity',
            change: -3,
        });
    });

    it('forgets the selection once the correction is sent, and keeps drawing it until the fit answers', () => {
        const { addTransformer } = mount();

        drag(dotAt(0), { clientX: 0, clientY: 100 }, { clientX: 0, clientY: 70 });
        clickToolbarButton('Apply correction');

        expect(addTransformer).toHaveBeenCalledTimes(1);
        expect(screen.getByText('nothing')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apply correction' })).toBeDisabled();
        // The sent correction is previewed once and only once: the blue ghost that says where the
        // dot came from, and no grey one beside it double-counting the call now in the chain.
        const ghosts = [...document.querySelectorAll('circle[fill="none"]')];
        expect(ghosts).toHaveLength(1);
        expect(ghosts[0]?.getAttribute('stroke')).toBe('hsl(220, 60%, 50%)');
    });
});
