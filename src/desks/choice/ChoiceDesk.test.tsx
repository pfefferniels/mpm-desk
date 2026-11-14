import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import type { CallOutcome } from '../../fitting/fit';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { createMpm } from '../../fitting/instructions/index';
import { MakeChoice, type MakeChoiceOptions } from '../../fitting/transformers/choice/MakeChoice';
import type { Call } from '../../model/Work';
import { ChoiceDesk } from './ChoiceDesk';

/**
 * What the desk holds after a click, read off the toolbar's own scope readout.
 *
 * The selection is component state and the readout is the only place it is said out loud, which
 * makes it the honest thing to assert: it is what the user is told the choice will cover, and it
 * is built from the same `from`/`to` the call carries.
 */

const note = (id: string, date: number, source: string, velocity: number): AlignedNote => ({
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
    source,
});

const onsets = [
    ['a', 0],
    ['b', 720],
    ['c', 1440],
    ['d', 2160],
] as const;

/** Four notes, each read twice: the two takes Base Text exists to choose between. */
const alignment = () =>
    new Alignment(
        onsets.flatMap(([id, date]) => [note(id, date, 'rec1', 64), note(id, date, 'rec2', 80)]),
    );

/**
 * The desk under its own subject: the alignment as loaded, with every reading standing, and what
 * the chain made of it.
 *
 * `residual={null}` is what the editor hands it while the readings stand, and the only thing it
 * could hand: a residual over two readings would measure one take against another, so
 * `deriveResidual` refuses one. This desk is where the choice that lifts that is made, and it reads
 * the recorded values off the rows.
 *
 * The choices are run as the chain runs them, so `msm` is what the desk is handed after a fit:
 * the rows they took and no others, on the axis `shift` moved them to.
 */
interface MountOptions {
    /** False to mount the desk as the viewer has it. */
    editable?: boolean;
    /** The calls selected, and what the run reported for them. */
    selected?: { ids: string[]; outcomes: CallOutcome[] };
    /** The `MakeChoice` calls of the chain, in order; the first is `choice`, the next `choice2`. */
    choices?: MakeChoiceOptions[];
    /** Take the leader before the first note off the fitted recording, as `InsertTempo` does. */
    shift?: boolean;
    /** Where the recording begins, in milliseconds before the first note. */
    leader?: number;
}

const mount = ({ editable = true, selected, choices = [], shift = false, leader = 0 }: MountOptions = {}) => {
    const pristine = alignment();
    pristine.allNotes.forEach((row) => {
        row['milliseconds.date'] += leader;
        row['milliseconds.date.end'] += leader;
    });

    const calls: Call[] = choices.map((options, i) => ({
        id: i === 0 ? 'choice' : `choice${String(i + 1)}`,
        name: 'MakeChoice',
        options: options as Record<string, unknown>,
    }));
    const msm = pristine.deepClone();
    for (const options of choices) new MakeChoice(options).run(msm, createMpm());
    if (shift) msm.shiftToFirstOnset();

    const addTransformer = vi.fn();
    const setActiveCallIds = vi.fn();

    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const { container } = render(
        <EditingContext value={editable}>
            <ScoreDocumentProvider mei={undefined} setMei={vi.fn()} recording="" pristine={pristine}>
                <ScrollSyncProvider symbolicZoom={20} physicalZoom={20}>
                    <CallSelectionProvider
                        calls={calls}
                        outcomes={selected?.outcomes ?? []}
                        activeCallIds={new Set(selected?.ids ?? [])}
                        setActiveCallIds={setActiveCallIds}
                        onRemoveCalls={vi.fn()}
                        focusCall={vi.fn()}
                    >
                        <DeskToolbarProvider target={bar}>
                            <ChoiceDesk
                                part="global"
                                msm={msm}
                                mpm={createMpm()}
                                residual={null}
                                performanceXml=""
                                secondary={{}}
                                setSecondary={vi.fn()}
                                addTransformer={addTransformer as (transformer: MakeChoice) => void}
                            />
                        </DeskToolbarProvider>
                    </CallSelectionProvider>
                </ScrollSyncProvider>
            </ScoreDocumentProvider>
        </EditingContext>,
    );

    /** A note is drawn once per reading, so the first rect carrying the id is as good as any. */
    const click = (id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean } = {}) => {
        const rect = container.querySelector(`rect[data-id="${id}"]`);
        if (!rect) throw new Error(`no note ${id} on the roll`);
        fireEvent.click(rect, modifiers);
    };

    /** In the toolbar, as the legend under the roll counts notes too. */
    const scope = () => within(bar).getByText(/notes$|^ticks|^default$/).textContent;
    const readout = () => within(bar).queryByText(/notes$|^ticks|^default$/);

    /** The score notes whose group is marked as evidence. */
    const marked = () =>
        [...container.querySelectorAll('g[data-evidence]')].map((group) =>
            group.getAttribute('data-note'),
        );

    /** The bars drawn, as `note/reading`, and those of them marked as what the chain took. */
    const bars = (selector = 'rect[data-source]') =>
        [...container.querySelectorAll(selector)].map(
            (rect) => `${rect.getAttribute('data-id') ?? ''}/${rect.getAttribute('data-source') ?? ''}`,
        );
    const taken = () => bars('rect[data-taken]');

    /** What the legend says of one reading. */
    const legendOf = (source: string) =>
        container.querySelector(`[data-legend] [data-reading="${source}"]`)?.textContent ?? '';

    const preference = (call: string) => {
        const button = container.querySelector(`[data-legend] button[data-call="${call}"]`);
        if (!button) throw new Error(`no preference of ${call} in the legend`);
        return button as HTMLButtonElement;
    };

    return {
        container,
        click,
        scope,
        readout,
        addTransformer,
        setActiveCallIds,
        marked,
        bars,
        taken,
        legendOf,
        preference,
    };
};

/**
 * First in the file, because React says a key is missing once per component and then never again:
 * after any other mount the warning would already be spent and this would pass on broken keys.
 */
describe('drawing the readings', () => {
    it('keys every reading of a note apart', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            mount();
            expect(error.mock.calls.flat().join(' ')).not.toMatch(/unique "key"/);
        } finally {
            error.mockRestore();
        }
    });
});

describe('marking out what a choice covers', () => {
    it('takes a plain click as the one note', () => {
        const { click, scope } = mount();

        click('b');

        expect(scope()).toBe('1 notes');
    });

    /**
     * Issue #26. `from` was the earliest date already picked and `to` the date just clicked, so a
     * shift-click before the selection left `from` > `to`. Nothing downstream reorders them:
     * `MakeChoice` selects on `date >= from && date <= to`, which an inverted pair never satisfies,
     * so the call went through and chose between no readings at all.
     */
    it('reaches backwards over a note as readily as forwards', () => {
        const { click, scope } = mount();

        click('c');
        click('a', { shiftKey: true });

        expect(scope()).toBe('ticks 0–1440');
    });

    it('reaches backwards from a stretch that is already open', () => {
        const { click, scope } = mount();

        click('b');
        click('c', { shiftKey: true });
        click('a', { shiftKey: true });

        expect(scope()).toBe('ticks 0–1440');
    });

    it('moves the end nearer the click and holds the far one', () => {
        const { click, scope } = mount();

        click('a');
        click('d', { shiftKey: true });
        click('b', { shiftKey: true });

        expect(scope()).toBe('ticks 720–2160');
    });

    it('falls back to the clicked note where nothing is left to reach from', () => {
        // A cmd-click takes the last id back out, and `Math.min()` over no dates is `Infinity`.
        const { click, scope } = mount();

        click('b');
        click('b', { metaKey: true });
        click('a', { shiftKey: true });

        expect(scope()).toBe('1 notes');
    });
});

describe('in the viewer', () => {
    it('makes no choice, and a click on a note scopes nothing', () => {
        const { click, readout, addTransformer } = mount({ editable: false });

        expect(screen.queryByRole('button', { name: 'Make Choice' })).toBeNull();
        expect(readout()).toBeNull();

        click('b');

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(addTransformer).not.toHaveBeenCalled();
    });
});

describe('what a selected choice was made for', () => {
    it('marks the notes the choice names, and no others', () => {
        const { marked } = mount({
            selected: {
                ids: ['choice'],
                outcomes: [{ id: 'choice', elements: [], range: { from: 720, to: 1440 }, evidence: ['b', 'c'] }],
            },
        });

        expect(marked()).toEqual(['b', 'c']);
    });
});

/**
 * The published reconstruction makes one choice, for the whole piece, and the desk was handed the
 * chain's output: a row per note, all of the preferred take. Every bar on the roll was that take's,
 * and nothing on the desk said there had been another, which one was chosen or over what.
 */
describe('every reading, and what the chain took of each', () => {
    it('draws the reading a choice set aside as well as the one it took', () => {
        const { bars, taken } = mount({ editable: false, choices: [{ prefer: 'rec1' }] });

        expect(bars().filter((bar) => bar.endsWith('/rec1'))).toHaveLength(4);
        expect(bars().filter((bar) => bar.endsWith('/rec2'))).toHaveLength(4);
        expect(taken()).toEqual(['a/rec1', 'b/rec1', 'c/rec1', 'd/rec1']);
    });

    it('marks nothing as taken while the readings still stand', () => {
        const { bars, taken, legendOf } = mount();

        expect(bars()).toHaveLength(8);
        expect(taken()).toEqual([]);
        expect(legendOf('rec1')).toContain('not preferred');
        expect(legendOf('rec2')).toContain('not preferred');
    });

    it('names each reading and says which a choice for the piece prefers', () => {
        const { legendOf } = mount({ editable: false, choices: [{ prefer: 'rec1' }] });

        expect(legendOf('rec1')).toContain('rec1');
        expect(legendOf('rec1')).toContain('preferred');
        expect(legendOf('rec1')).toContain('for the whole piece');
        expect(legendOf('rec1')).toContain('taken for 4 of 4 notes');
        expect(legendOf('rec2')).toContain('not preferred');
        expect(legendOf('rec2')).toContain('taken for 0 of 4 notes');
    });

    it('says a narrower choice by its range, and takes the reading there alone', () => {
        const { legendOf, taken } = mount({
            choices: [{ scope: 'global', from: 720, to: 1440, prefer: 'rec2' }],
        });

        expect(legendOf('rec2')).toContain('for ticks 720–1440');
        expect(legendOf('rec2')).toContain('taken for 2 of 4 notes');
        expect(taken()).toEqual(['b/rec2', 'c/rec2']);
    });

    it('says a choice for named notes by how many it names', () => {
        const { legendOf, taken } = mount({ choices: [{ scope: 'global', noteIDs: ['d'], prefer: 'rec2' }] });

        expect(legendOf('rec2')).toContain('for 1 note');
        expect(taken()).toEqual(['d/rec2']);
    });

    it('says what a split choice takes from each reading', () => {
        const { legendOf, taken } = mount({
            choices: [{ velocity: 'rec2', timing: 'rec1', pedalling: 'rec1' }],
        });

        expect(legendOf('rec1')).toContain('for timing and pedalling, over the whole piece');
        expect(legendOf('rec2')).toContain('for loudness, over the whole piece');
        // The row kept is the timing reading's, carrying the other's velocity.
        expect(taken()).toEqual(['a/rec1', 'b/rec1', 'c/rec1', 'd/rec1']);
    });

    /**
     * What was asked and what happened can differ, and the counts say what happened: the first
     * choice to reach a note settles it, and a later one finds its reading already set aside there.
     */
    it('counts what was taken, not what was preferred', () => {
        const { legendOf } = mount({
            choices: [{ prefer: 'rec1' }, { scope: 'global', noteIDs: ['a'], prefer: 'rec2' }],
        });

        expect(legendOf('rec2')).toContain('for 1 note');
        expect(legendOf('rec2')).toContain('taken for 0 of 4 notes');
        expect(legendOf('rec1')).toContain('taken for 4 of 4 notes');
    });

    it('selects a choice from the legend, and shows it selected', () => {
        const { preference, setActiveCallIds } = mount({ editable: false, choices: [{ prefer: 'rec1' }] });

        expect(preference('choice').getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(preference('choice'));
        expect(setActiveCallIds).toHaveBeenCalledWith(new Set(['choice']));

        const selected = mount({
            editable: false,
            choices: [{ prefer: 'rec1' }],
            selected: { ids: ['choice'], outcomes: [] },
        });
        expect(selected.container.querySelectorAll('button[data-call="choice"][aria-pressed="true"]')).toHaveLength(1);
    });

    /**
     * `InsertTempo` takes the leader before the first note off every event, and every other desk,
     * the scroll they share and a call revealed by its range count from there. The recorded rows
     * still start at the roll's, so drawn as they are they sat a leader's width to the right.
     */
    it('draws the recorded readings on the axis the chain left the recording on', () => {
        const { container } = mount({ editable: false, choices: [{ prefer: 'rec1' }], shift: true, leader: 28618 });

        const xs = [...container.querySelectorAll('rect[data-id="a"]')].map((rect) => rect.getAttribute('x'));
        expect(xs).toEqual(['0', '0']);
    });
});
