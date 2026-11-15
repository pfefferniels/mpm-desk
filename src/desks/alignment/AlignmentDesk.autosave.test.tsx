import { beforeAll, describe, expect, it } from 'vitest';
import { act, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { PerformancesProvider } from '../../hooks/Performances';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { writtenIdOf } from '../../alignment/transcription';
import { initialHistory, workHistoryReducer } from '../../model/workReducer';
import { aligned, scoreMei, span } from '../../../tests/alignment/transcription/fixture';
import { AlignmentDesk } from './AlignmentDesk';

/**
 * The desk over a document that lives: what the desk writes is what it reads next.
 *
 * Nothing is pressed to keep a change. That is only true if *every* change reaches the document,
 * and the ones that nearly did not are the quiet ones: a note put on the other staff is the same
 * note with the same name in the same reading, and a desk that asks whether the document holds
 * the page's notes is told that it does.
 */

const octave = span('x1', 5, 36);
const start = aligned(scoreMei(), { extra: [octave], unplayed: ['n6'] });

let desk: HTMLElement;
let bar: HTMLElement;
/** Every text the document has been, the latest last */
const written: string[] = [];

const Living = () => {
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

/** The staff the added note stands on, in the latest text of the document */
const staffOfTheNote = () => {
    const doc = new DOMParser().parseFromString(written.at(-1)!, 'application/xml');
    const note = [...doc.querySelectorAll('note')].find(
        (entry) => entry.getAttribute('xml:id') === writtenIdOf(octave),
    );
    return note?.closest('staff')?.getAttribute('n');
};

beforeAll(async () => {
    desk = document.createElement('div');
    bar = document.createElement('div');
    document.body.append(desk, bar);

    await act(async () => {
        createRoot(desk).render(<Living />);
    });
    await settle(() => desk.querySelector('.alignment-added') !== null);

    await click(desk.querySelector('.alignment-added'));
    await settle(() => document.querySelector('.MuiPopover-paper .alignment-bar svg') !== null);
}, 120_000);

describe('the alignment desk, over a document that takes what it writes', () => {
    it('writes a change of how the note is written, once', async () => {
        await click(kind('Grace'));
        await settle(() => written.length > 0);
        expect(written.at(-1)).toContain('grace=');

        // The document now holds the page, and saying so again is not a change
        const count = written.length;
        await wait(1500);
        expect(written).toHaveLength(count);
    });

    it('writes the note back as a note', async () => {
        const count = written.length;
        await click(kind('Notes'));
        await settle(() => written.length > count);

        expect(written.at(-1)).not.toContain('grace=');
        expect(staffOfTheNote()).toBe('2');
    });

    it('writes a change of nothing but where the note stands', async () => {
        const count = written.length;
        await click(document.querySelector('.MuiPopover-paper button[aria-label="Other staff"]'));
        await settle(() => written.length > count);

        expect(written.length).toBeGreaterThan(count);
        expect(staffOfTheNote()).toBe('1');
    });

    it('and is quiet again afterwards', async () => {
        const count = written.length;
        await wait(1500);
        expect(written).toHaveLength(count);
    });
});
