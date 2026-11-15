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

    it('opens the bar on the note, drawn the ordinary way and coloured as the page is', async () => {
        await click(desk.querySelector('.alignment-added'));
        await settle(() => document.querySelector('.MuiPopover-paper .alignment-bar svg') !== null);

        const bar = document.querySelector('.MuiPopover-paper .alignment-bar');
        expect(bar?.querySelectorAll('.alignment-added')).toHaveLength(1);
        // The note in hand is ringed, not recoloured: green is what says it was added
        expect(bar?.querySelector('.alignment-editing')?.getAttribute('data-id')).toBe(writtenIdOf(octave));
        // One bar and no more
        expect(bar?.querySelector('[data-id="n1"]')).not.toBeNull();
        expect(bar?.querySelector('[data-id="n5"]')).toBeNull();
    });

    it('says nothing in words: the ways of writing it, and the hands to move it', () => {
        const card = document.querySelector('.MuiPopover-paper');
        const kinds = card?.querySelector('[aria-label="Written as"]');

        // Three ways of being in the score at most, and none of not being in it
        expect([...kinds!.querySelectorAll('button')].map((entry) => entry.textContent)).toEqual([
            'Notes',
            'Grace',
        ]);
        expect(kinds?.querySelector('[aria-pressed="true"]')?.textContent).toBe('Notes');
        for (const name of ['Earlier', 'Later', 'Shorter', 'Longer', 'Other staff']) {
            expect(card?.querySelector(`button[aria-label="${name}"]`), name).not.toBeNull();
        }
        expect(card?.querySelector('p')).toBeNull();
    });

    const lastRecorded = () =>
        dispatch.mock.calls
            .map(
                ([action]) =>
                    action as {
                        type: string;
                        alignment?: {
                            resolutions: Map<string, { action: string }>;
                            edits: Map<string, { onset?: number; staff?: string }>;
                        };
                    },
            )
            .filter((action) => action.type === 'set-alignment')
            .at(-1)?.alignment;

    it('moves the note along the bar, and records where to', async () => {
        // On the downbeat with the bass, so there is nowhere earlier and somewhere later
        expect(document.querySelector<HTMLButtonElement>('button[aria-label="Earlier"]')?.disabled).toBe(true);
        await click(document.querySelector('button[aria-label="Later"]'));

        const moved = lastRecorded()?.edits.get(writtenIdOf(octave));
        expect(moved?.onset).toBeGreaterThan(0);
        expect(moved?.onset).toBeLessThan(2);
    });

    it('puts it on the other staff', async () => {
        await click(document.querySelector('button[aria-label="Other staff"]'));
        expect(lastRecorded()?.edits.get(writtenIdOf(octave))?.staff).toBe('1');
    });

    it('records a change of mind as the one decision the reader made', async () => {
        await click(button('Grace'));
        expect([...lastRecorded()!.resolutions.values()].map((entry) => entry.action)).toEqual(['write-graces']);
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

    it('says on the call for this recording which readings it wrote', () => {
        const written = setMei.mock.calls[0][0] as string;
        const said = dispatch.mock.calls
            .map(([action]) => action as { type: string; readings?: string[] })
            .filter((action) => action.type === 'set-alignment')
            .at(-1)?.readings;

        expect(said?.length).toBeGreaterThan(0);
        // Each is the name of a reading that is in the score, and there is no other
        const inScore = [...written.matchAll(/<app type="transcription" xml:id="([^"]+)"/g)].map((found) => found[1]);
        expect([...(said ?? [])].sort()).toEqual([...inScore].sort());
    });
});
