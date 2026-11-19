import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { PerformancesProvider } from '../../hooks/Performances';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { initialHistory } from '../../model/workReducer';
import { aligned, scoreMei } from '../../../tests/alignment/transcription/fixture';
import { AlignmentDesk } from './AlignmentDesk';

/**
 * The bar under the pointer, as it was played.
 *
 * The page is the score; how a bar was played is shown when the pointer rests on one of its
 * notes, as a piano roll, and not otherwise. Bar 2's e5 was not played here.
 */
const mei = aligned(scoreMei(), { unplayed: ['n6'] });

let root: Root;
let desk: HTMLElement;
let toolbar: HTMLElement;

beforeAll(async () => {
    desk = document.createElement('div');
    toolbar = document.createElement('div');
    document.body.append(desk, toolbar);
    root = createRoot(desk);
    await act(async () => {
        root.render(
            <WorkDocumentProvider history={initialHistory()} dispatch={vi.fn()}>
                <ScoreDocumentProvider mei={mei} setMei={vi.fn()} recording="" pristine={null}>
                    <PerformancesProvider value={{ performances: [], openPerformance: vi.fn() }}>
                        <DeskToolbarProvider target={toolbar}>
                            <AlignmentDesk />
                        </DeskToolbarProvider>
                    </PerformancesProvider>
                </ScoreDocumentProvider>
            </WorkDocumentProvider>,
        );
    });
    await settle(() => desk.querySelector('.alignment-unplayed') !== null);
}, 60_000);

afterAll(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
});

const settle = async (until: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !until(); attempt++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
    }
};

const rest = async (id: string) => {
    const head = desk.querySelector(`.alignment-score [data-id="${id}"] .notehead`)!;
    await act(async () => {
        head.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
};
const roll = () => document.querySelector('[data-roll-preview]');

describe('resting the pointer on a note', () => {
    it('shows the bar it is in as it was played, with its key ringed', async () => {
        await rest('n5');
        await settle(() => roll() !== null);

        expect(roll()?.textContent).toContain('Bar 2, as played');
        // f5, e5 left out, d5 in the right hand, and the c3 under them
        const kinds = [...roll()!.querySelectorAll('rect[data-kind]')].map((rect) => rect.getAttribute('data-kind'));
        expect(kinds.filter((kind) => kind === 'matched')).toHaveLength(3);
        expect(kinds.filter((kind) => kind === 'unplayed')).toHaveLength(1);
        expect(roll()!.querySelectorAll('rect[stroke="#1d4ed8"]')).toHaveLength(1);
    });

    it('shows nothing once the reader has turned it off', async () => {
        await act(async () => {
            toolbar.querySelector<HTMLButtonElement>('button[aria-label="Roll on hover"]')!.click();
        });
        await settle(() => roll() === null);
        await rest('n7');
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
        });

        expect(roll()).toBeNull();
    });
});
