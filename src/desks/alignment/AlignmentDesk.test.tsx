import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { PerformancesProvider } from '../../hooks/Performances';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { initialHistory } from '../../model/workReducer';
import { AlignmentDesk } from './AlignmentDesk';

/**
 * The desk, mounted over an alignment the document already holds.
 *
 * The model is never run. What is checked is the half that works without it, which is the path a
 * *reopened* project takes: a `<recording>` already in the MEI comes back as something to review,
 * the score is drawn along the time it was played in, and the colours land on the right
 * noteheads.
 *
 * `alignScoreToPerformance` needs no stub. Nothing calls it here, and `src/alignment/mlign`
 * reaches the model runtime through a dynamic import, so importing the module fetches no weights
 * and no WebAssembly.
 *
 * Mounted once with `createRoot` rather than testing-library's `render`: engraving this score
 * takes the better part of half a minute under jsdom, and `render` is cleaned up after every
 * test, so every assertion after the first would look at a tree that had been taken down.
 */

vi.mock('react-pianosound', () => ({
    usePiano: () => ({ play: vi.fn(), stop: vi.fn() }),
}));

const mei = readFileSync(join(__dirname, '..', '..', '..', 'public', 'transcription.mei'), 'utf-8');

let desk: HTMLElement;
let bar: HTMLElement;

const settle = async (until: () => boolean) => {
    for (let attempt = 0; attempt < 400 && !until(); attempt++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
    }
};

beforeAll(async () => {
    desk = document.createElement('div');
    bar = document.createElement('div');
    document.body.append(desk, bar);

    await act(async () => {
        createRoot(desk).render(
            <WorkDocumentProvider history={initialHistory()} dispatch={vi.fn()}>
                <ScoreDocumentProvider mei={mei} setMei={vi.fn()} recording="">
                    <PerformancesProvider value={{ performances: [], openPerformance: vi.fn() }}>
                        <DeskToolbarProvider target={bar}>
                            <AlignmentDesk />
                        </DeskToolbarProvider>
                    </PerformancesProvider>
                </ScoreDocumentProvider>
            </WorkDocumentProvider>,
        );
    });

    await settle(() => desk.querySelector('.alignment-matched') !== null);
}, 180_000);

describe('the alignment desk, over a recording the document already holds', () => {
    it('draws the score along the time it was played in', () => {
        expect(desk.querySelectorAll('.note').length).toBeGreaterThan(50);
        expect(desk.querySelector('.performanceRuler')).not.toBeNull();
    });

    it('colours the notes the recording answered to, with no model having run', () => {
        // Read out of the MEI's own <when> elements — which is the whole point of the format
        expect(desk.querySelectorAll('.alignment-matched').length).toBeGreaterThan(50);
    });

    it('offers the takes the score itself holds, not only the ones somebody opened', () => {
        const recordings = bar.querySelector<HTMLSelectElement>('[aria-label="Recording"]');
        expect(recordings).not.toBeNull();
        expect(recordings!.options.length).toBe(2);
    });

    it('will not align without a recording to align against', () => {
        // Every control is there whether or not it can be used; a disabled one says why
        expect(bar.textContent).toContain('Align');
        expect(bar.querySelector('button:disabled')).not.toBeNull();
    });
});
