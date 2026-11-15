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
 * Saying that a played note is a written one.
 *
 * The aligner pairs what it can, and leaves two loose halves where it cannot: a key with nothing
 * written for it and a note nothing played. Whether those are one note, struck late or at another
 * pitch, is something a reader can see and the desk cannot know, so the card has a way of saying
 * it: the tool, and then the other note.
 *
 * Bar 2 here has both halves. The e5 was due at 2500 ms and nothing played it; an f5 was struck
 * 300 ms after that.
 */

const late = span('x1', 2800, 77);
const mei = aligned(scoreMei(), { extra: [late], unplayed: ['n6'] });

let desk: HTMLElement;
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

const TOOL = 'button[aria-label="It is a written note: click which"]';
const bar = () => document.querySelector('.MuiPopover-paper .alignment-bar');

beforeAll(async () => {
    desk = document.createElement('div');
    const toolbar = document.createElement('div');
    document.body.append(desk, toolbar);

    await act(async () => {
        createRoot(desk).render(
            <WorkDocumentProvider history={initialHistory()} dispatch={dispatch}>
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

    await settle(() => desk.querySelector('.alignment-added') !== null);
    await click(desk.querySelector('.alignment-added'));
    await settle(() => bar()?.querySelector('svg') !== null);
}, 120_000);

describe('matching a played note to a written one', () => {
    it('offers it where the bar holds a written note nothing played', () => {
        expect(document.querySelector(TOOL)).not.toBeNull();
        // Nothing is ringed until it is asked for
        expect(bar()?.querySelector('.alignment-pickable')).toBeNull();
    });

    it('rings the written note it could be, once asked', async () => {
        await click(document.querySelector(TOOL));

        expect(document.querySelector(TOOL)?.getAttribute('aria-pressed')).toBe('true');
        expect([...bar()!.querySelectorAll('.alignment-pickable')].map((note) => note.getAttribute('data-id'))).toEqual([
            'n6',
        ]);
    });

    it('records the two as one note when that note is clicked', async () => {
        await click(bar()?.querySelector('[data-id="n6"]'));

        const recorded = dispatch.mock.calls
            .map(([action]) => action as { type: string; alignment?: { edits: Map<string, { is?: string }> } })
            .filter((action) => action.type === 'set-alignment')
            .at(-1)?.alignment;
        expect(recorded?.edits.get(writtenIdOf(late))).toEqual({ is: 'n6' });
    });
});
