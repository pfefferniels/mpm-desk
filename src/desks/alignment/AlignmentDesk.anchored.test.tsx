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
 * A doubtful match drawn where the score puts it, on the desk itself.
 *
 * The desk writes a fresh run into the document a moment after it was made and reads the alignment
 * back out of the document from then on. So the state worth testing is a document that holds a
 * run: if the doubt does not come back out of it, the page forgets it within a second of
 * aligning, which is what the first version of this did.
 *
 * Bar 2's e5 was due at 2500 ms, half way between the f5 and the d5 either side of it, and the
 * model matched it, without being sure, to a key struck at 2800.
 */
const withRun = (confidences: boolean) => {
    const doc = new DOMParser().parseFromString(scoreMei(), 'application/xml');
    const recording = insertRecording(doc, SOURCE)!;
    for (const [id, { ms, pitch }] of Object.entries(PLAYED)) {
        const doubtful = id === 'n6';
        insertWhen(
            doc,
            recording,
            span(`perf-${id}`, doubtful ? 2800 : ms, pitch, 450),
            id,
            confidences ? (doubtful ? 0.05 : 0.999) : undefined,
        );
    }
    return new XMLSerializer().serializeToString(doc);
};

let root: Root | undefined;
let desk: HTMLElement;

afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
});

const open = async (mei: string) => {
    desk = document.createElement('div');
    const toolbar = document.createElement('div');
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

const onsetOf = (id: string) =>
    desk.querySelector(`.alignment-score [data-id="${id}"]`)?.getAttribute('data-perf-onset');
const toggle = () => document.querySelector<HTMLButtonElement>('button[aria-label="Unsure as written"]');

describe('a doubtful match, in a document that holds the run', () => {
    it('is drawn where it was due', async () => {
        await open(withRun(true));
        await settle(() => onsetOf('n6') === '2500');

        expect(onsetOf('n6')).toBe('2500');
        expect(onsetOf('n5')).toBe('2000');
        expect(toggle()?.disabled).toBe(false);
        expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
    }, 60_000);

    it('is drawn where it was struck once the reader turns that off', async () => {
        await open(withRun(true));
        await settle(() => onsetOf('n6') === '2500');
        expect(onsetOf('n6')).toBe('2500');

        await act(async () => {
            toggle()!.click();
        });
        await settle(() => onsetOf('n6') === '2800');

        expect(onsetOf('n6')).toBe('2800');
    }, 60_000);
});

describe('a document that does not say how sure the model was', () => {
    it('is drawn as it was struck, and offers nothing to turn on', async () => {
        await open(withRun(false));
        await settle(() => onsetOf('n6') !== undefined && onsetOf('n6') !== null && toggle() !== null);

        expect(onsetOf('n6')).toBe('2800');
        expect(toggle()?.disabled).toBe(true);
    }, 60_000);
});
