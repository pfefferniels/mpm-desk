import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Alignment, type AlignedGrace, type AlignedNote } from '../../fitting/alignment';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import type { CallOutcome } from '../../fitting/fit';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { NoteOffShift, OrnamentNote } from 'espressivo';
import {
    createMpm,
    ensureDefaultStyle,
    insertDefinition,
    type Mpm,
    OrnamentDef,
    requireMap,
    type Scope,
} from '../../fitting/instructions/index';
import { InsertTemporalSpread } from '../../fitting/transformers/ornamentation/InsertTemporalSpread';
import { InsertGraceNotes } from '../../fitting/transformers/ornamentation/InsertGraceNotes';
import { GRACE_COLOUR } from './graceFigures';
import type { Residual } from '../../fitting/residual';
import { TemporalSpreadDesk } from './TemporalSpreadDesk';

/**
 * The click track `TemporalSpreadInstruction` auditions a written spread with.
 *
 * Answered here rather than loaded: Tone 14's ESM imports its own files without an extension,
 * which Vite resolves in the browser and Node, resolving an externalised dependency itself, does
 * not. The one written spread this file draws is never auditioned — it is the import that needs
 * an answer.
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

/** A grace note of `group`, leading to `principal` and struck `lead` ms before `ms`. */
const grace = (
    id: string,
    group: string,
    principal: string,
    date: number,
    ms: number,
    part = 1,
): AlignedGrace => ({
    'xml:id': id,
    group,
    principal,
    tied: false,
    part,
    date,
    slot: 0,
    'midi.pitch': 67,
    velocity: 50,
    'milliseconds.date': ms,
    'milliseconds.date.end': ms + 80,
});

/** The same score with a grace note before `d`, in part 1, and one before `f`, in part 2. */
const withGraces = () => {
    const msm = alignment();
    msm.graces = [
        grace('g1', 'gg', 'd', 720, 820),
        grace('g2', 'hh', 'f', 1440, 1700, 2),
    ];
    return msm;
};

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

interface MountOptions {
    /** False to mount the desk as the viewer has it. */
    editable?: boolean;
    /** The calls selected, and what the run reported for them. */
    selected?: { ids: string[]; outcomes: CallOutcome[] };
    /** The document the chain has written so far; an empty one by default. */
    mpm?: Mpm;
    /** The score and its recording; `alignment()` by default. */
    msm?: Alignment;
}

const mount = (
    part: Scope = 'global',
    { editable = true, selected, mpm = createMpm(), msm = alignment() }: MountOptions = {},
) => {
    const addTransformer = vi.fn();

    // The app bar's second row, standing in for `EditorAppBar`'s. A desk under a null target
    // renders no toolbar at all, so without this the controls under test are simply absent.
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const { unmount } = render(
        <EditingContext value={editable}>
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
                        outcomes={selected?.outcomes ?? []}
                        activeCallIds={new Set(selected?.ids ?? [])}
                        setActiveCallIds={vi.fn()}
                        onRemoveCalls={vi.fn()}
                        focusCall={vi.fn()}
                    >
                        <DeskToolbarProvider target={bar}>
                            <TemporalSpreadDesk
                                part={part}
                                msm={msm}
                                mpm={mpm}
                                residual={residual()}
                                performanceXml=''
                                secondary={{}}
                                setSecondary={vi.fn()}
                                addTransformer={addTransformer}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </ZoomContext>
        </EditingContext>,
    );

    return {
        addTransformer,
        /** One group per chord plotted. */
        chords: () => document.querySelectorAll('g.chord'),
        /** One line per note of them, plus the placement line every chord carries. */
        lines: () => document.querySelectorAll('g.chord line'),
        /** One group per spread the document holds here, a roll's or a grace figure's. */
        written: () => document.querySelectorAll('g.temporalSpreadInstruction'),
        /** One group per grace figure plotted. */
        figures: () => document.querySelectorAll<SVGGElement>('g.graceFigure'),
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

describe('the spreads it draws as written', () => {
    /** A definition holding one frame in ticks, as a stylized ornament's does. */
    const framed = (mpm: Mpm, name: string, offset: number, length: number) => {
        const built = OrnamentDef.createOrnamentDef(name);
        if (!built.ok) throw new Error(`no definition can be named ${name}`);
        built.value.setTemporalSpreadFrame(
            { value: offset, domain: 'ticks' },
            { value: length, domain: 'ticks' },
            1,
            NoteOffShift.Monophonic,
        );
        insertDefinition(mpm, 'ornamentDef', built.value, 'global');
    };

    /** The chord at tick 720 with its roll written, and the grace figure before its `d`. */
    const stylized = () => {
        const mpm = createMpm();
        framed(mpm, 'roll', -60, 120);
        framed(mpm, 'figure', -300, 300);
        ensureDefaultStyle(mpm, 'ornament', 'global');
        const map = requireMap(mpm, 'ornament', 'global');
        map.addOrnamentV3({ id: 'ornament_720', date: 720, nameRef: 'roll', noteOrder: 'ascending pitch' });
        map.addOrnamentV3({
            id: 'grace_gg',
            date: 720,
            nameRef: 'figure',
            noteid: '#d',
            noteOrder: '#g1 #d',
            notes: [new OrnamentNote('g1', { kind: 'midi', value: 67 })],
        });
        return mpm;
    };

    const fillOf = (group: Element | null) => group?.querySelector('rect')?.getAttribute('fill');

    // Both are ornaments with a frame in ticks once the chain has stylized them, and both are
    // drawn. What says which is which is the colour.
    it('is a roll in grey and a grace figure in its own colour', () => {
        const desk = mount('global', { mpm: stylized(), msm: withGraces() });

        expect(desk.written()).toHaveLength(2);
        expect(fillOf(document.querySelector('[data-ornament="ornament_720"]'))).toBe('gray');
        expect(fillOf(document.querySelector('[data-ornament="grace_gg"]'))).toBe(GRACE_COLOUR);
        desk.dispose();
    });

    // The figure names one note of the chord and is no roll of it: taken for one, the chord
    // would read as written and lose the line that says where an insert would place it.
    it('does not take a figure on one of its notes for the roll of a chord', () => {
        const mpm = createMpm();
        framed(mpm, 'figure', -300, 300);
        ensureDefaultStyle(mpm, 'ornament', 'global');
        requireMap(mpm, 'ornament', 'global').addOrnamentV3({
            id: 'grace_gg',
            date: 720,
            nameRef: 'figure',
            noteid: '#d',
            noteOrder: '#g1 #d',
            notes: [new OrnamentNote('g1', { kind: 'midi', value: 67 })],
        });
        const desk = mount('global', { mpm, msm: withGraces() });

        act(() => {
            fireEvent.click(document.querySelector('g.chord[data-date="720"] rect') as Element);
        });
        // Between `c` at 1000 ms and `d` at 1120, where the default placement estimates the beat.
        const placed = document.querySelector('g.chord[data-date="720"] line[stroke="red"]');
        expect(Number(placed?.getAttribute('x1'))).toBeCloseTo(21.2, 6);
        desk.dispose();
    });
});

describe('the grace figures it plots', () => {
    it('draws the figures of the scope, from the first grace note to the strike of the principal', () => {
        const inScope = (part: Scope) => {
            const desk = mount(part, { msm: withGraces() });
            const groups = [...desk.figures()].map((figure) => figure.dataset.group);
            desk.dispose();
            return groups;
        };

        expect(inScope('global')).toEqual(['gg', 'hh']);
        expect(inScope(0)).toEqual(['gg']);
        expect(inScope(1)).toEqual(['hh']);

        // `g1` at 820 ms and `d` at 1120, at 20 px a second.
        const desk = mount('global', { msm: withGraces() });
        const frame = desk.figures()[0]?.querySelector('rect');
        expect(Number(frame?.getAttribute('x'))).toBeCloseTo(16.4, 6);
        expect(Number(frame?.getAttribute('width'))).toBeCloseTo(6, 6);
        expect(frame?.getAttribute('fill')).toBe(GRACE_COLOUR);
        desk.dispose();
    });

    it('writes the selected figure as a grace notes call, with no dialog to pass', () => {
        const { addTransformer, figures, dispose } = mount(1, { msm: withGraces() });

        act(() => {
            fireEvent.click(figures()[0]?.querySelector('rect') as Element);
        });
        expect(figures()[0]?.dataset.selected).toBe('true');
        act(() => {
            screen.getByRole('button', { name: 'Insert' }).click();
        });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(addTransformer).toHaveBeenCalledTimes(1);
        const sent = addTransformer.mock.calls[0][0] as InsertGraceNotes;
        expect(sent).toBeInstanceOf(InsertGraceNotes);
        expect(sent.options).toEqual({ scope: 1, group: 'hh' });
        dispose();
    });

    // One selection between the two, so that Insert never has to say which it means.
    it('lets go of the figure when a chord is chosen', () => {
        const { figures, dispose } = mount('global', { msm: withGraces() });

        act(() => {
            fireEvent.click(figures()[0]?.querySelector('rect') as Element);
        });
        act(() => {
            fireEvent.click(document.querySelector('g.chord[data-date="720"] rect') as Element);
        });
        expect(figures()[0]?.dataset.selected).toBeUndefined();
        act(() => {
            screen.getByRole('button', { name: 'Insert' }).click();
        });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        dispose();
    });

    it('is only read in the viewer', () => {
        const { figures, dispose } = mount('global', { msm: withGraces(), editable: false });

        expect(figures()).toHaveLength(2);
        act(() => {
            fireEvent.click(figures()[0]?.querySelector('rect') as Element);
        });
        expect(figures()[0]?.dataset.selected).toBeUndefined();
        dispose();
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

describe('in the viewer', () => {
    it('offers no insert, and a click on a chord selects nothing to insert on', () => {
        const desk = mount('global', { editable: false });

        expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Insert Default' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove Default' })).toBeNull();
        // What only draws the plot stays.
        expect(screen.getByLabelText('Beat Length')).toBeInTheDocument();

        const chord = document.querySelector('g.chord rect');
        if (!chord) throw new Error('no chord to click');
        act(() => {
            chord.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(desk.addTransformer).not.toHaveBeenCalled();
        desk.dispose();
    });
});

describe('what a selected call was fitted to', () => {
    it('marks the chord the spread was fitted to, and no other', () => {
        const desk = mount('global', {
            selected: {
                ids: ['spread'],
                outcomes: [
                    {
                        id: 'spread',
                        elements: ['ornament_720'],
                        range: { from: 720, to: null },
                        evidence: ['c', 'd'],
                    },
                ],
            },
        });

        const marked = [...desk.chords()].filter((chord) => chord.hasAttribute('data-evidence'));
        expect(marked.map((chord) => chord.getAttribute('data-date'))).toEqual(['720']);
        desk.dispose();
    });

    it('marks nothing while nothing is selected', () => {
        const desk = mount();
        expect(document.querySelectorAll('[data-evidence]')).toHaveLength(0);
        desk.dispose();
    });
});
