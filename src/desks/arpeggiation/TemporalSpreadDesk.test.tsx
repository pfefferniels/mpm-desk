import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { createMpm, type Scope } from '../../fitting/instructions/index';
import { InsertTemporalSpread } from '../../fitting/transformers/ornamentation/InsertTemporalSpread';
import type { Residual } from '../../fitting/residual';
import { TemporalSpreadDesk } from './TemporalSpreadDesk';

/** The chords sound as the pointer passes them, and Tone in jsdom is a slow way to assert nothing. */
vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn(), playSingleNote: vi.fn() }),
}));

/**
 * The click track `TemporalSpreadInstruction` auditions a written spread with.
 *
 * Answered here rather than loaded: Tone 14's ESM imports its own files without an extension,
 * which Vite resolves in the browser and Node, resolving an externalised dependency itself, does
 * not. No written spread is rendered in this file anyway — it is the import that needs an answer.
 */
vi.mock('tone', () => ({
    NoiseSynth: class {
        toDestination() {
            return this;
        }
        triggerAttackRelease() {}
    },
    now: () => 0,
}));

const note = (
    id: string,
    date: number,
    milliseconds: number,
    pitch: number,
    part = 1,
): AlignedNote => ({
    'xml:id': id,
    part,
    staff: '1',
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': milliseconds,
    'milliseconds.date.end': milliseconds + 500,
    'midi.pitch': pitch,
    velocity: 64,
});

/**
 * Rolled chords over two parts: what a default insert is for.
 *
 * The chord at tick 0 spans both, which is the case the scope has to survive — in the shipped
 * transcription 100 of the 215 chords are shared that way.
 */
const alignment = () =>
    new Alignment([
        note('a', 0, 0, 60),
        note('b', 0, 80, 64),
        note('c', 720, 1000, 62),
        note('d', 720, 1120, 65),
        note('e', 0, 40, 48, 2),
        note('f', 1440, 2000, 43, 2),
        note('g', 1440, 2120, 47, 2),
    ]);

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

const mount = (part: Scope = 'global') => {
    const msm = alignment();
    const addTransformer = vi.fn();

    // The app bar's second row, standing in for `EditorAppBar`'s. A desk under a null target
    // renders no toolbar at all, so without this the controls under test are simply absent.
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const { unmount } = render(
        <ZoomContext
            value={{
                symbolic: { stretchX: 0.1 },
                physical: { stretchX: 20 },
                setStretchX: vi.fn(),
            }}
        >
            <ScrollSyncProvider
                symbolicZoom={0.1}
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
                        <TemporalSpreadDesk
                            part={part}
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
        </ZoomContext>,
    );

    return {
        addTransformer,
        /** One group per chord plotted. */
        chords: () => document.querySelectorAll('g.chord'),
        /** One line per note of them, plus the placement line every chord carries. */
        lines: () => document.querySelectorAll('g.chord line'),
        dispose: () => {
            unmount();
            bar.remove();
        },
    };
};

/** The dialog's own Insert, which is not the bar's button of the same name. */
const confirm = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Insert' });

const thresholdField = () =>
    screen.getByLabelText('Duration Threshold (ms)') as HTMLInputElement;

const openDefaultDialog = () => {
    act(() => {
        screen.getByRole('button', { name: 'Insert Default' }).click();
    });
};

const type = (value: string) => {
    fireEvent.change(thresholdField(), { target: { value } });
};

const sentOptions = (addTransformer: ReturnType<typeof vi.fn>) => {
    expect(addTransformer).toHaveBeenCalledTimes(1);
    const sent = addTransformer.mock.calls[0][0] as InsertTemporalSpread;
    expect(sent).toBeInstanceOf(InsertTemporalSpread);
    return sent.options;
};

describe('what the desk plots', () => {
    it('draws the chords of the scope on the picker, and no others', () => {
        const inScope = (part: Scope) => {
            const desk = mount(part);
            const chords = desk.chords().length;
            const counts = { chords, notes: desk.lines().length - chords };
            desk.dispose();
            return counts;
        };

        // The parts together draw one chord more than the whole score does, because the chord at
        // tick 0 belongs to both. Drawn unscoped they would each draw all three.
        expect(inScope('global')).toEqual({ chords: 3, notes: 7 });
        expect(inScope(0)).toEqual({ chords: 2, notes: 4 });
        expect(inScope(1)).toEqual({ chords: 2, notes: 3 });
    });
});

describe('the default insert', () => {
    it('sends the threshold the dialog collected', () => {
        const { addTransformer } = mount();

        openDefaultDialog();
        type('120');
        act(() => {
            confirm().click();
        });

        expect(sentOptions(addTransformer)).toMatchObject({
            scope: 'global',
            durationThreshold: 120,
        });
    });

    it('sends 35 where the field was left alone', () => {
        const { addTransformer } = mount();

        openDefaultDialog();
        expect(thresholdField().value).toBe('35');
        act(() => {
            confirm().click();
        });

        expect(sentOptions(addTransformer)).toMatchObject({ durationThreshold: 35 });
    });

    it('spreads every rolled chord at a threshold of zero', () => {
        const { addTransformer } = mount();

        openDefaultDialog();
        type('0');
        act(() => {
            confirm().click();
        });

        expect(sentOptions(addTransformer)).toMatchObject({ durationThreshold: 0 });
    });

    /** The box has to be emptiable, and an empty box is no threshold at all — see `useNumberField`. */
    it('lets the box be cleared, and falls back while it is', () => {
        const { addTransformer } = mount();

        openDefaultDialog();
        type('');

        expect(thresholdField().value).toBe('');

        act(() => {
            confirm().click();
        });

        expect(sentOptions(addTransformer)).toMatchObject({ durationThreshold: 35 });
    });
});

describe('the single insert', () => {
    it('offers no threshold, having a date instead', () => {
        const { addTransformer } = mount();

        const chord = document.querySelector('g.chord rect');
        if (!chord) throw new Error('no chord to select');
        act(() => {
            chord.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        act(() => {
            screen.getByRole('button', { name: 'Insert' }).click();
        });

        // The dialog is open on the chord, and the threshold is absent from it because a single
        // spread is placed by date.
        expect(screen.getByRole('dialog')).toHaveTextContent('Temporal Spread @0');
        expect(screen.queryByLabelText('Duration Threshold (ms)')).toBeNull();

        act(() => {
            confirm().click();
        });

        expect(sentOptions(addTransformer)).toMatchObject({ date: 0 });
    });
});
