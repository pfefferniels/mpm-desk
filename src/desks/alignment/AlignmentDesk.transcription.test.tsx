import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { PerformancesProvider } from '../../hooks/Performances';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { writtenIdOf } from '../../alignment/transcription';
import { initialHistory } from '../../model/workReducer';
import { aligned, scoreMei, span } from '../../../tests/alignment/transcription/fixture';
import { AlignmentDesk } from './AlignmentDesk';

/**
 * The desk over a document that holds an alignment with differences in it and no transcription.
 *
 * That is what Align leaves before Write, and what an older project opens as. The model is not
 * run: the differences are read out of the `<recording>`, which is the point of keeping them
 * there, and the transcription is derived from them on the spot.
 *
 * Two bars, one note added and one left out, so that everything on the page can be named.
 */

const octave = span('x1', 5, 36);
const mei = aligned(scoreMei(), { extra: [octave], unplayed: ['n6'] });

let desk: HTMLElement;
let bar: HTMLElement;
const setMei = vi.fn();
const dispatch = vi.fn();

const settle = async (until: () => boolean) => {
    for (let attempt = 0; attempt < 400 && !until(); attempt++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
    }
};

const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
        element!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
};

const button = (name: string) =>
    [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === name);

beforeAll(async () => {
    desk = document.createElement('div');
    bar = document.createElement('div');
    document.body.append(desk, bar);

    await act(async () => {
        createRoot(desk).render(
            <WorkDocumentProvider history={initialHistory()} dispatch={dispatch}>
                <ScoreDocumentProvider mei={mei} setMei={setMei} recording="" pristine={null}>
                    <PerformancesProvider value={{ performances: [], openPerformance: vi.fn() }}>
                        <DeskToolbarProvider target={bar}>
                            <AlignmentDesk />
                        </DeskToolbarProvider>
                    </PerformancesProvider>
                </ScoreDocumentProvider>
            </WorkDocumentProvider>,
        );
    });

    await settle(() => desk.querySelector('.alignment-added') !== null);
}, 120_000);

describe('the alignment desk, over differences nobody has written yet', () => {
    it('shows the added note as a note of the score, in the colour of an addition', () => {
        const green = desk.querySelectorAll('.alignment-added');

        expect(green).toHaveLength(1);
        expect(green[0].getAttribute('data-id')).toBe(writtenIdOf(octave));
        // A notehead verovio engraved, and no cross beside it saying the same thing again
        expect(green[0].classList.contains('note')).toBe(true);
        expect(desk.querySelector('.performanceExtraNote')).toBeNull();
    });

    it('keeps the note that was left out on the page, in the colour of an omission', () => {
        const red = desk.querySelectorAll('.alignment-unplayed');

        expect(red).toHaveLength(1);
        expect(red[0].getAttribute('data-id')).toBe('n6');
    });

    it('says what the colours mean and how much of each there is', () => {
        expect(bar.textContent).toContain('1 added');
        expect(bar.textContent).toContain('1 left out');
        expect(bar.textContent).toContain('0 changed');
    });

    it('offers to write it, because the document does not hold it yet', () => {
        expect(button('Write into score')?.disabled).toBe(false);
    });

    it('says on the note how it was written, and offers the other ways', async () => {
        await click(desk.querySelector('.alignment-added'));

        const card = document.querySelector('.MuiPopover-paper');
        expect(card?.textContent).toContain('in bar 1 on beat 1');
        expect(card?.textContent).toContain('with what is written there');

        const written = card?.querySelector('[aria-label="Written as"]');
        expect([...written!.querySelectorAll('button')].map((entry) => entry.textContent)).toEqual([
            'Notes',
            'Grace notes',
            'Leave out',
        ]);
        expect(written?.querySelector('[aria-pressed="true"]')?.textContent).toBe('Notes');
    });

    it('records a change of mind as the one decision the reader made', async () => {
        await click(button('Leave out'));

        const recorded = dispatch.mock.calls
            .map(([action]) => action as { type: string; alignment?: { resolutions: Map<string, { action: string }> } })
            .filter((action) => action.type === 'set-alignment')
            .at(-1);

        expect(recorded).toBeDefined();
        expect([...recorded!.alignment!.resolutions.values()].map((entry) => entry.action)).toEqual(['record']);
    });

    it('writes the transcription into the document, readings and all', async () => {
        await click(button('Write into score'));

        expect(setMei).toHaveBeenCalledTimes(1);
        const written = setMei.mock.calls[0][0] as string;
        expect(written).toContain('type="transcription"');
        expect(written).toContain(`xml:id="${writtenIdOf(octave)}"`);
        // The note left out is in the source reading and a rest stands in the played one
        expect(written).toMatch(/<rdg source="original"><note xml:id="n6"/);
    });
});
