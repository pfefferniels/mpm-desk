import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { createMpm } from '../../fitting/instructions/index';
import { deriveResidual } from '../../fitting/residual';
import type { MakeChoice } from '../../fitting/transformers/choice/MakeChoice';
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

const mount = () => {
    const msm = alignment();
    const addTransformer = vi.fn();

    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const { container } = render(
        <ScrollSyncProvider symbolicZoom={20} physicalZoom={20}>
            <DeskToolbarProvider target={bar}>
                <ChoiceDesk
                    part="global"
                    msm={msm}
                    mpm={createMpm()}
                    residual={deriveResidual(msm, createMpm())}
                    projected={[]}
                    performanceXml=""
                    secondary={{}}
                    setSecondary={vi.fn()}
                    addTransformer={addTransformer as (transformer: MakeChoice) => void}
                />
            </DeskToolbarProvider>
        </ScrollSyncProvider>,
    );

    /** A note is drawn once per reading, so the first rect carrying the id is as good as any. */
    const click = (id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean } = {}) => {
        const rect = container.querySelector(`rect[data-id="${id}"]`);
        if (!rect) throw new Error(`no note ${id} on the roll`);
        fireEvent.click(rect, modifiers);
    };

    const scope = () => screen.getByText(/notes$|^ticks|^default$/).textContent;

    return { click, scope, addTransformer };
};

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
