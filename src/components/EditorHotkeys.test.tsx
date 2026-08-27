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
import { act } from 'react';
import { createFakePiano } from '../test/fakePiano';
import { readNoteDates } from '../utils/score';
import { ZoomContext } from '../hooks/ZoomProvider';
import { PlaybackProvider } from '../hooks/PlaybackProvider';
import { WorkDocumentProvider } from '../hooks/WorkDocument';
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

const mount = (onSave = () => {}, onOpen = () => {}) =>
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
                    <EditorHotkeys onSave={onSave} onOpen={onOpen} />
                    <button>Insert</button>
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
        mount(onSave);

        // jsdom is not a Mac, so `mod+s` resolves to Ctrl here — which is the point: the two
        // shortcuts this replaced were bound `meta+`, and did nothing off a Mac.
        press(document, { key: 's', code: 'KeyS', ctrlKey: true });

        expect(onSave).toHaveBeenCalledTimes(1);
    });
});
