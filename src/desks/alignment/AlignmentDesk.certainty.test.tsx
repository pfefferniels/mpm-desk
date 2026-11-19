import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { PerformancesProvider } from '../../hooks/Performances';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { insertRecording, insertWhen } from '../../mei/when';
import { initialHistory } from '../../model/workReducer';
import { PLAYED, SOURCE, scoreMei, span } from '../../../tests/alignment/transcription/fixture';
import { AlignmentDesk } from './AlignmentDesk';

/**
 * How sure the model was, drawn on the notated page as how faint a note is.
 *
 * The desk writes a fresh run into the document a moment after it was made and reads the alignment
 * back out of the document from then on. So the state worth testing is a document that holds a
 * run: if the doubt did not come back out of it, the page would forget it within a second of
 * aligning, which is what an earlier version of this desk did.
 *
 * Bar 2's e5 was matched without the model being sure of it.
 */
const withRun = (confidences: boolean) => {
    const doc = new DOMParser().parseFromString(scoreMei(), 'application/xml');
    const recording = insertRecording(doc, SOURCE)!;
    for (const [id, { ms, pitch }] of Object.entries(PLAYED)) {
        const confidence = id === 'n6' ? 0.05 : 0.999;
        insertWhen(doc, recording, span(`perf-${id}`, ms, pitch, 450), id, confidences ? confidence : undefined);
    }
    return new XMLSerializer().serializeToString(doc);
};

let root: Root | undefined;
let desk: HTMLElement;
let toolbar: HTMLElement;

afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
});

const open = async (mei: string) => {
    desk = document.createElement('div');
    toolbar = document.createElement('div');
    document.body.append(desk, toolbar);
    root = createRoot(desk);
    await act(async () => {
        root!.render(
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
};

const settle = async (until: () => boolean) => {
    for (let attempt = 0; attempt < 400 && !until(); attempt++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
    }
};

const inkOf = (id: string) =>
    desk
        .querySelector<SVGElement>(`.alignment-score [data-id="${id}"] .notehead`)
        ?.style.getPropertyValue('opacity');

describe('a document that holds a run', () => {
    it('draws the note the model was unsure of faint, and the ones it was sure of in full', async () => {
        await open(withRun(true));
        await settle(() => inkOf('n6') === '0.24');

        expect(inkOf('n6')).toBe('0.24');
        expect(inkOf('n5')).toBe('1');
    }, 60_000);

    it('draws every note in full along the recording, where the ink says how softly it was played', async () => {
        await open(withRun(true));
        await settle(() => inkOf('n6') === '0.24');

        await act(async () => {
            toolbar.querySelector<HTMLButtonElement>('button[aria-label="Performed"]')!.click();
        });
        await settle(() => desk.querySelector('.performanceRuler') !== null);

        expect(desk.querySelector('[data-certainty]')).toBeNull();
    }, 60_000);
});

describe('a document that does not say how sure the model was', () => {
    it('draws every note in full', async () => {
        await open(withRun(false));
        await settle(() => desk.querySelector('.alignment-matched') !== null);

        expect(desk.querySelector('.alignment-matched')).not.toBeNull();
        expect(desk.querySelector('[data-certainty]')).toBeNull();
    }, 60_000);
});
