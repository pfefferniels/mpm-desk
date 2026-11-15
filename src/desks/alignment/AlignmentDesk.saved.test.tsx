import { beforeAll, describe, expect, it } from 'vitest';
import { act, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { PerformancesProvider } from '../../hooks/Performances';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { transcribe } from '../../alignment/transcription';
import { strictRecordings } from '../../alignment/transcription/strictRecordings';
import { initialHistory, workHistoryReducer } from '../../model/workReducer';
import { SOURCE, added, aligned, missing, scoreMei, span } from '../../../tests/alignment/transcription/fixture';
import { AlignmentDesk } from './AlignmentDesk';

/**
 * The desk over a document that was saved and opened again.
 *
 * A saved recording is an as-played-by one: notes that sounded, and nothing of what the aligner
 * could not pair. The desk has to find the differences again in the score alone, show them as it
 * did, and take a change of mind as it would on a document it had never let go of.
 */

const octave = span('x1', 5, 36);
const start = strictRecordings(
    transcribe({
        mei: aligned(scoreMei(), { extra: [octave], unplayed: ['n6'] }),
        source: SOURCE,
        divergences: [added('a', [octave], 'added-octave'), missing('m', ['n6'])],
        spans: [octave],
    }).mei,
);

let desk: HTMLElement;
let bar: HTMLElement;
/** Every text the document has been, the latest last */
const written: string[] = [];

const Reopened = () => {
    const [mei, setMei] = useState(start);
    const [history, dispatch] = useReducer(workHistoryReducer, initialHistory());
    return (
        <WorkDocumentProvider history={history} dispatch={dispatch}>
            <ScoreDocumentProvider
                mei={mei}
                setMei={(next) => {
                    written.push(next);
                    setMei(next);
                }}
                recording=""
                pristine={null}
            >
                <PerformancesProvider value={{ performances: [], openPerformance: () => Promise.resolve(undefined) }}>
                    <DeskToolbarProvider target={bar}>
                        <AlignmentDesk />
                    </DeskToolbarProvider>
                </PerformancesProvider>
            </ScoreDocumentProvider>
        </WorkDocumentProvider>
    );
};

const settle = async (until: () => boolean) => {
    for (let attempt = 0; attempt < 400 && !until(); attempt++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
    }
};

const wait = (ms: number) =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });

const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
        element!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
};

const kind = (name: string) =>
    [...document.querySelectorAll('.MuiPopover-paper button')].find(
        (entry) => entry.textContent?.trim() === name,
    );

beforeAll(async () => {
    desk = document.createElement('div');
    bar = document.createElement('div');
    document.body.append(desk, bar);

    await act(async () => {
        createRoot(desk).render(<Reopened />);
    });
    await settle(() => desk.querySelector('.alignment-added') !== null);
}, 120_000);

describe('the alignment desk, over a document that was saved', () => {
    it('is handed a recording of notes that sounded and nothing else', () => {
        expect(start).toContain('type="match"');
        expect(start).not.toMatch(/type="(insertion|deletion|substitution|transcribed)"/);
    });

    it('shows what was played differently all the same', () => {
        expect(desk.querySelector('.alignment-added')).not.toBeNull();
    });

    it('writes nothing for being looked at', async () => {
        await wait(1500);
        expect(written).toHaveLength(0);
    });

    it('takes a change of mind, writes it once, and is quiet again', async () => {
        await click(desk.querySelector('.alignment-added'));
        await settle(() => document.querySelector('.MuiPopover-paper .alignment-bar svg') !== null);

        await click(kind('Grace'));
        await settle(() => written.length > 0);
        expect(written.at(-1)).toContain('grace=');

        const count = written.length;
        await wait(1500);
        expect(written).toHaveLength(count);
    });

    it('saves what it wrote as the same kind of document again', () => {
        const saved = strictRecordings(written.at(-1)!);

        expect(saved).not.toMatch(/type="(insertion|deletion|substitution|transcribed)"/);
        expect(saved).toContain('grace=');
        // The note that was not played is still said so by nothing pointing at it
        expect(saved).not.toContain('data="#n6"');
    });
});
