/**
 * The editor's keyboard, and the one shortcut that used to fight the buttons.
 *
 * `space` toggles playback, and `space` is also how a focused button is activated. The library's
 * skip-list covers form tags and widget roles but not `button`, so before the guard in
 * `EditorHotkeys` a click on Insert followed by a press of the space bar started playback — and
 * `preventDefault: true` swallowed the button's own activation on the way past.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { act, useState, type ReactNode } from 'react';
import { createFakePiano } from '../test/fakePiano';
import { readNoteDates } from '../utils/score';
import { ZoomContext } from '../hooks/ZoomProvider';
import { PlaybackProvider } from '../hooks/PlaybackProvider';
import { WorkDocumentProvider } from '../hooks/WorkDocument';
import { CallSelectionProvider } from '../hooks/CallSelection';
import { initialHistory } from '../model/workReducer';
import { EditorHotkeys } from './EditorHotkeys';

let rig = createFakePiano();

vi.mock('react-pianosound', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-pianosound')>()),
    usePiano: () => rig.usePiano(),
}));

const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8');
const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');
const dateByNoteId = readNoteDates(scoreMsm);

/** The selection as the editor holds it: state, so removing the selected calls can clear it. */
const Selection = ({
    selected,
    onRemoveCalls,
    children,
}: {
    selected: Set<string>;
    onRemoveCalls: (ids: readonly string[]) => void;
    children: ReactNode;
}) => {
    const [activeCallIds, setActiveCallIds] = useState(selected);
    return (
        <CallSelectionProvider
            calls={[]}
            outcomes={[]}
            activeCallIds={activeCallIds}
            setActiveCallIds={setActiveCallIds}
            onRemoveCalls={onRemoveCalls}
            focusCall={() => {}}
        >
            {children}
        </CallSelectionProvider>
    );
};

const mount = ({
    onSave = () => {},
    onOpen = () => {},
    selected = new Set<string>(),
    onRemoveCalls = () => {},
}: {
    onSave?: () => void;
    onOpen?: () => void;
    selected?: Set<string>;
    onRemoveCalls?: (ids: readonly string[]) => void;
} = {}) =>
    render(
        <ZoomContext
            value={{
                symbolic: { stretchX: 20 },
                physical: { stretchX: 20 },
                setStretchX: () => {},
            }}
        >
            <WorkDocumentProvider history={initialHistory()} dispatch={() => {}}>
                <PlaybackProvider
                    scoreMsm={scoreMsm}
                    performanceMpm={performanceMpm}
                    dateByNoteId={dateByNoteId}
                >
                    <Selection selected={selected} onRemoveCalls={onRemoveCalls}>
                        <EditorHotkeys onSave={onSave} onOpen={onOpen} />
                        <button>Insert</button>
                    </Selection>
                </PlaybackProvider>
            </WorkDocumentProvider>
        </ZoomContext>,
    );

/** A keydown as the document sees it, with the browser's own default still available to cancel. */
const press = (target: Element | Document, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => {
        target.dispatchEvent(event);
    });
    return event;
};

describe('EditorHotkeys', () => {
    beforeEach(() => {
        rig = createFakePiano();
    });

    it('leaves the space bar to a focused button', () => {
        mount();
        const button = screen.getByRole('button', { name: 'Insert' });
        button.focus();

        const event = press(button, { key: ' ', code: 'Space' });

        // Not merely "playback did not start": the event must reach the browser uncancelled, or
        // the button never fires either and the key does nothing at all.
        expect(event.defaultPrevented).toBe(false);
        expect(rig.played).toHaveLength(0);
    });

    it('leaves the space bar to the scope picker', () => {
        // MUI renders a `Select`'s display node as a `<div role="combobox">`, which is neither a
        // button nor on the library's skip-list — and MUI opens its menu on Space. Without the
        // guard the dropdown opens *and* playback starts, which is what happens if you pick a
        // part and then press the shortcut the Play tooltip advertises.
        mount();
        const combobox = document.createElement('div');
        combobox.setAttribute('role', 'combobox');
        combobox.tabIndex = 0;
        document.body.appendChild(combobox);
        combobox.focus();

        const event = press(combobox, { key: ' ', code: 'Space' });

        expect(event.defaultPrevented).toBe(false);
        expect(rig.played).toHaveLength(0);
    });

    it('still toggles playback from the page', () => {
        mount();

        const event = press(document, { key: ' ', code: 'Space' });

        expect(event.defaultPrevented).toBe(true);
        expect(rig.played.length).toBeGreaterThan(0);
    });

    it('saves on the platform modifier, not on Command alone', () => {
        const onSave = vi.fn();
        mount({ onSave });

        // jsdom is not a Mac, so `mod+s` resolves to Ctrl here — which is the point: the two
        // shortcuts this replaced were bound `meta+`, and did nothing off a Mac.
        press(document, { key: 's', code: 'KeyS', ctrlKey: true });

        expect(onSave).toHaveBeenCalledTimes(1);
    });
});

describe('removing the selected calls', () => {
    it.each(['Backspace', 'Delete'])('%s removes them, and is spent on it', (key) => {
        const onRemoveCalls = vi.fn();
        mount({ selected: new Set(['a', 'b']), onRemoveCalls });

        const event = press(document, { key, code: key });

        expect(onRemoveCalls).toHaveBeenCalledWith(['a', 'b']);
        expect(event.defaultPrevented).toBe(true);
    });

    it('leaves an idle Backspace to the browser', () => {
        const onRemoveCalls = vi.fn();
        mount({ onRemoveCalls });

        const event = press(document, { key: 'Backspace', code: 'Backspace' });

        expect(onRemoveCalls).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('leaves Backspace to a text field', () => {
        // The narrative desk's Word field and the metadata desk's title take Backspace as text,
        // with a call selected or not.
        const onRemoveCalls = vi.fn();
        mount({ selected: new Set(['a']), onRemoveCalls });
        const field = document.createElement('input');
        document.body.appendChild(field);
        field.focus();

        const event = press(field, { key: 'Backspace', code: 'Backspace' });

        expect(onRemoveCalls).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        field.remove();
    });
});
