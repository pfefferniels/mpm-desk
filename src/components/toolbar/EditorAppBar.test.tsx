/**
 * The app bar, and the four properties it is easy to lose: a transport that explains itself
 * rather than disappearing, an undo stack with a UI, a scope picker that cannot be set to `null`,
 * and a busy indicator that holds its place while idle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createFakePiano } from '../../test/fakePiano';
import { readNoteDates } from '../../utils/score';
import { ZoomContext } from '../../hooks/ZoomProvider';
import { PlaybackProvider } from '../../hooks/PlaybackProvider';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { initialHistory, workHistoryReducer } from '../../model/workReducer';
import type { WorkHistory } from '../../model/workReducer';
import type { Scope } from '../../fitting/instructions/index';
import { NO_SCOPE_LOCK } from '../../desks/scopeLock';
import { EditorAppBar } from './EditorAppBar';

let rig = createFakePiano();

vi.mock('react-pianosound', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-pianosound')>()),
    usePiano: () => rig.usePiano(),
}));

const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8');
const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');
const dateByNoteId = readNoteDates(scoreMsm);

/** A history with one call in it, so undo has something to offer. */
const edited = (): WorkHistory =>
    workHistoryReducer(initialHistory(), {
        type: 'add-call',
        call: { id: 'call-1', name: 'InsertTempo', options: {} },
    });

const Providers = ({ history, children }: { history: WorkHistory; children: ReactNode }) => (
    <ZoomContext
        value={{
            symbolic: { stretchX: 20 },
            physical: { stretchX: 20 },
            setStretchX: () => {},
        }}
    >
        <WorkDocumentProvider history={history} dispatch={() => {}}>
            <PlaybackProvider
                scoreMsm={scoreMsm}
                performanceMpm={performanceMpm}
                dateByNoteId={dateByNoteId}
            >
                {children}
            </PlaybackProvider>
        </WorkDocumentProvider>
    </ZoomContext>
);

type Overrides = Partial<Parameters<typeof EditorAppBar>[0]> & { history?: WorkHistory };

const mount = ({ history = initialHistory(), ...props }: Overrides = {}) =>
    render(
        <Providers history={history}>
            <EditorAppBar
                deskRowRef={() => {}}
                deskName='tempo'
                parts={[{ scope: 0, label: 'Part 1' }, { scope: 1, label: 'Part 2' }]}
                scope='global'
                setScope={() => {}}
                scopeLock={NO_SCOPE_LOCK}
                pending={false}
                dirty={false}
                canPlay
                canSave
                onSave={() => {}}
                onOpen={() => {}}
                {...props}
            />
        </Providers>,
    );

describe('EditorAppBar', () => {
    beforeEach(() => {
        rig = createFakePiano();
    });

    it('disables the transport rather than hiding it', () => {
        // Play must be disabled rather than absent: with nothing to hear there would otherwise be
        // nowhere to read why.
        mount({ canPlay: false });

        const play = screen.getByRole('button', { name: /play/i });
        expect(play).toBeInTheDocument();
        expect(play).toBeDisabled();
    });

    it('offers undo only when there is something to undo', () => {
        mount();
        expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /redo/i })).toBeDisabled();

        mount({ history: edited() });
        // `getAllBy`: the first mount is still in the document.
        const undos = screen.getAllByRole('button', { name: /undo/i });
        expect(undos.at(-1)).toBeEnabled();
    });

    it('names the parts the way the desks do, and never answers with null', () => {
        const setScope = vi.fn();
        mount({ setScope });

        // MUI opens its `Select` on mousedown, not click.
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Scope' }));
        const options = within(screen.getByRole('listbox')).getAllByRole('option');
        // `Part 1`, not the raw index `0` the ToggleButtonGroup showed.
        expect(options.map((option) => option.textContent)).toEqual([
            'Global',
            'Part 1',
            'Part 2',
        ]);

        fireEvent.click(screen.getByRole('option', { name: 'Part 2' }));
        expect(setScope).toHaveBeenCalledWith(1);
        // The whole reason this is a `Select`: an exclusive `ToggleButtonGroup` answers a click
        // on the already-selected button with `null`, and `null` is not a scope.
        expect(setScope).not.toHaveBeenCalledWith(null);
    });

    it('locks the parts, and says what took them, where a part map would shadow the global one', () => {
        const setScope = vi.fn();
        const note = 'global is already set';
        mount({
            setScope,
            scopeLock: {
                locked: new Map<Scope, string>([
                    [0, note],
                    [1, note],
                ]),
                holding: ['global'],
            },
        });

        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Scope' }));
        const listbox = within(screen.getByRole('listbox'));

        // Offered, not hidden: a picker that loses its options teaches nothing about why.
        expect(listbox.getByRole('option', { name: 'Global' })).toBeEnabled();
        expect(listbox.getByRole('option', { name: /Part 1/ })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        // The note stands on each option it explains, not once under the list.
        expect(listbox.getAllByText(note)).toHaveLength(2);

        fireEvent.click(screen.getByRole('option', { name: /Part 2/ }));
        expect(setScope).not.toHaveBeenCalled();
    });

    it('locks Global instead, where the parts are the ones already set', () => {
        // The other direction of the same rule: a global map written beside a part's own is a
        // write that part will not read. See `scopeLock.ts`.
        const setScope = vi.fn();
        const note = 'Part 1 is already set';
        mount({
            scope: 0,
            setScope,
            scopeLock: { locked: new Map<Scope, string>([['global', note]]), holding: [0] },
        });

        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Scope' }));
        const listbox = within(screen.getByRole('listbox'));

        expect(listbox.getByRole('option', { name: /Global/ })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        expect(listbox.getByRole('option', { name: 'Part 1' })).toBeEnabled();
        expect(listbox.getByRole('option', { name: 'Part 2' })).toBeEnabled();
        expect(listbox.getByText(note)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('option', { name: /Global/ }));
        expect(setScope).not.toHaveBeenCalled();
    });

    it('keeps the fit indicator in the tree while it is idle', () => {
        // A live region that is unmounted while idle announces nothing when it comes back: the
        // region has to already be in the accessibility tree for a change inside it to be seen.
        const { rerender } = mount({ pending: false });

        const status = screen.getByRole('status');
        expect(status).toBeInTheDocument();
        expect(status).toBeEmptyDOMElement();

        rerender(
            <Providers history={initialHistory()}>
                <EditorAppBar
                    deskRowRef={() => {}}
                    deskName='tempo'
                    parts={[{ scope: 0, label: 'Part 1' }, { scope: 1, label: 'Part 2' }]}
                    scope='global'
                    setScope={() => {}}
                    scopeLock={NO_SCOPE_LOCK}
                    pending
                    dirty={false}
                    canPlay
                    canSave
                    onSave={() => {}}
                    onOpen={() => {}}
                />
            </Providers>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('refitting');
    });

    it('says whether there is anything to save', () => {
        mount({ canSave: false });
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('names the open desk', () => {
        mount({ deskName: 'metrical accentuation' });
        expect(screen.getByText('metrical accentuation')).toBeInTheDocument();
    });

    it('offers the open desk its help, from beside the desk name', () => {
        mount({
            deskName: 'tempo',
            help: {
                summary: 'The skyline.',
                actions: [{ gesture: 'Shift-click a box', does: 'add it to the selection' }],
            },
        });

        // Beside the name, and so ahead of the portal target: row two scrolls sideways once a
        // desk contributes more controls than fit, and this must not be what scrolls away.
        const button = screen.getByRole('button', { name: 'About the tempo desk' });
        expect(button.previousElementSibling).toHaveTextContent('tempo');

        fireEvent.click(button);
        expect(screen.getByText('The skyline.')).toBeInTheDocument();
        expect(screen.getByText('add it to the selection')).toBeInTheDocument();
    });

    it('says nothing about a desk the registry does not hold', () => {
        mount({ deskName: 'tempo', help: undefined });
        expect(screen.queryByRole('button', { name: /^About the/ })).toBeNull();
    });
});
