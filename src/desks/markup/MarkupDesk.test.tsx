/**
 * The markup desk, over the reconstruction the app ships.
 *
 * Three claims. The document arrives readable rather than as one line. The round trip works in
 * both directions — a selected call lands on its elements, and clicking an instruction opens the
 * desk that wrote it. And the two documents are named, with the toggle between them surviving
 * the click MUI answers with `null`.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, render, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Alignment } from '../../fitting/alignment';
import type { Residual } from '../../fitting/residual';
import type { Call } from '../../model/Work';
import { outcomesOf, type Reconstruction } from '../../model/Reconstruction';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { initialHistory } from '../../model/workReducer';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { parseMPM } from '../../fitting/instructions/index';
import { MarkupDesk } from './MarkupDesk';

const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');
const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8');
const mpm = parseMPM(performanceMpm);
const { segments: projected } = JSON.parse(
    readFileSync('src/test/fixtures/segments.json', 'utf-8'),
) as Reconstruction;

/** The work file the projection came from, read back off it: one call per span. */
const calls: Call[] = projected.flatMap((segment) =>
    segment.spans.map((span) => ({
        id: `call:${span.id}`,
        name: `Insert:${span.type}`,
        options: {},
        elements: [...span.elements],
        range: { from: span.from, to: span.to },
        segment: segment.id,
    })),
);
const outcomes = outcomesOf(calls);

/** A call that wrote at least one element, and the first element it wrote. */
const claimed = calls.find((call) => (call.elements ?? []).length > 0)!;
const claimedElement = claimed.elements![0];

/**
 * The alignment, stated as the two things this desk asks of it. Building a real one would be
 * building the fit, and neither serialisation is what is under test here.
 */
const alignment = {
    serialize: () => scoreMsm,
    serializeScore: () => scoreMsm,
} as unknown as Alignment;

interface HarnessProps {
    children: ReactNode;
    initial?: readonly string[];
    focusCall: (id: string) => void;
}

/**
 * Holds the editor's selection, and stands in for the app's `focusCall` — which is what a click
 * on an instruction reaches. The real one switches desk, sets the scope and pushes the hash; all
 * of that is `App`'s, so what this asserts is that the desk hands it the right call.
 */
const Harness = ({ children, initial = [], focusCall }: HarnessProps) => {
    const [active, setActive] = useState(() => new Set(initial));
    return (
        <CallSelectionProvider
            calls={calls}
            outcomes={outcomes}
            activeCallIds={active}
            setActiveCallIds={(next) => {
                setActive((prev) => (typeof next === 'function' ? next(prev) : next));
            }}
            onRemoveCalls={() => {}}
            focusCall={focusCall}
        >
            {children}
        </CallSelectionProvider>
    );
};

const mount = (initial?: readonly string[]) => {
    const focusCall = vi.fn();
    // The app bar's second row, standing in for `EditorAppBar`'s. A sibling of the desk and not a
    // child of it, which is where it really is — `DeskToolbar` renders nothing without a target,
    // so a test with no provider would be testing a desk that had lost its controls.
    const toolbar = document.createElement('div');
    document.body.appendChild(toolbar);

    const view = render(
        <Harness focusCall={focusCall} {...(initial !== undefined && { initial })}>
            <WorkDocumentProvider
                history={initialHistory({
                    name: 'Träumerei',
                    mei: '',
                    mpm: '',
                    provenance: [...calls],
                    segments: [],
                })}
                dispatch={() => {}}
            >
                <DeskToolbarProvider target={toolbar}>
                    <MarkupDesk
                        msm={alignment}
                        mpm={mpm}
                        residual={{} as Residual}
                        secondary={{}}
                        setSecondary={() => {}}
                        projected={projected}
                        performanceXml={performanceMpm}
                    />
                </DeskToolbarProvider>
            </WorkDocumentProvider>
        </Harness>,
    );

    return {
        ...view,
        focusCall,
        bar: within(toolbar),
        rows: () => [...view.container.querySelectorAll('[data-line]')],
    };
};

beforeAll(() => {
    // jsdom has no layout, so no element can be scrolled into view. The desk calls it whenever
    // the selection or the search moves, and an absent method is a `TypeError` mid-render.
    Element.prototype.scrollIntoView = vi.fn();
});

describe('MarkupDesk', () => {
    it('shows the document as lines rather than as one', () => {
        const { rows } = mount();

        expect(rows().length).toBeGreaterThan(1000);
        expect(rows()[0].textContent).toContain('<mpm');
    });

    it('names both documents, and says which is on screen', () => {
        const { bar, getByText, rows } = mount();

        expect(bar.getByRole('button', { name: 'MPM' })).toBeInTheDocument();
        expect(bar.getByRole('button', { name: 'MSM' })).toBeInTheDocument();
        expect(getByText(/performance markup this editor writes/)).toBeInTheDocument();

        fireEvent.click(bar.getByRole('button', { name: 'MSM' }));

        expect(getByText(/velocities and millisecond onsets as measured/)).toBeInTheDocument();
        expect(rows()[0].textContent).toContain('<msm');
    });

    /**
     * MUI's exclusive group answers a click on the pressed button with `null` and types it `any`,
     * so nothing catches it. There is no "no document" here — that click must do nothing.
     */
    it('stays on the pane you click twice', () => {
        const { bar, getByText } = mount();

        fireEvent.click(bar.getByRole('button', { name: 'MSM' }));
        fireEvent.click(bar.getByRole('button', { name: 'MSM' }));

        expect(getByText(/velocities and millisecond onsets as measured/)).toBeInTheDocument();
    });

    it('lights the lines a selected call wrote', () => {
        const { container } = mount([claimed.id]);

        const lit = [...container.querySelectorAll('[data-active]')];
        expect(lit.length).toBe(new Set(claimed.elements).size);
        expect(lit.map((row) => row.getAttribute('data-id'))).toContain(claimedElement);
    });

    it('opens the desk that wrote an instruction when its line is clicked', () => {
        const view = mount();

        fireEvent.click(view.container.querySelector(`[data-id="${claimedElement}"]`)!);

        expect(view.focusCall).toHaveBeenCalledWith(claimed.id);
    });

    it('says so on the line, so the click is not a surprise', () => {
        const view = mount();
        const row = view.container.querySelector(`[data-id="${claimedElement}"]`)!;

        expect(row.getAttribute('title')).toContain(claimedElement);
        expect(row.getAttribute('title')).toContain('Open the desk that wrote this');
    });

    /** Structure is not something the editor can talk about: only elements carry ids. */
    it('leaves a line with no xml:id inert', () => {
        const view = mount();
        const structural = view.rows().find((row) => !row.hasAttribute('data-id'))!;

        fireEvent.click(structural);

        expect(view.focusCall).not.toHaveBeenCalled();
    });

    /** The recording is not the document the calls wrote, so its lines answer to nothing. */
    it('leaves the recording pane inert', () => {
        const view = mount();
        fireEvent.click(view.bar.getByRole('button', { name: 'MSM' }));

        expect(view.container.querySelector('[data-id]')).toBeNull();
    });

    /**
     * There is no find field, on purpose: every line is in the DOM, so the browser's own search
     * already works over the whole document. What that costs is that the line numbers must not be
     * text — a hunt for `1440` would otherwise answer with line 1440 before any `date="1440"`.
     * They are a CSS counter, which find-in-page does not see and `textContent` does not carry.
     */
    it('leaves searching to the browser, and keeps the line numbers out of its way', () => {
        const view = mount();

        expect(view.bar.queryByLabelText('Find')).toBeNull();
        expect(view.rows()[1].textContent).toBe('  <metadata>');

        // The other half of that claim, and the only place it can be asked: jsdom parses the
        // rule but renders no pseudo-element, so "the numbers are still drawn" is a question
        // about the stylesheet. Worth asking, because a gutter that silently vanished would look
        // exactly like this test passing on the line above.
        const css = [...document.querySelectorAll('style')].map((tag) => tag.textContent).join('');
        expect(css).toContain('counter-increment:markup-line');
        expect(css).toContain('content:counter(markup-line)');
    });

    it('offers the MIDI as the one export, the markup being in the archive already', () => {
        const { bar } = mount();

        expect(bar.getByRole('button', { name: 'Download MIDI' })).toBeInTheDocument();
        expect(bar.queryByRole('button', { name: /Download MPM/ })).toBeNull();
        expect(bar.queryByRole('button', { name: /Clipboard/ })).toBeNull();
    });
});
