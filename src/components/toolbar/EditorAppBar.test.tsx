/**
 * The app bar, and the four things about it that were regressions.
 *
 * Each case here corresponds to something the old one-row bar got wrong: a transport that
 * disappeared instead of explaining itself, an undo stack with no UI at all, a scope picker that
 * could be set to `null`, and a busy indicator that only existed while it was busy.
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
                parts={[0, 1]}
                scope='global'
                setScope={() => {}}
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
        // The old bar wrapped Play in `getInstructions(mpm).length > 0 && …`, so with nothing to
        // hear the control was simply absent and there was nowhere to read why.
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
                    parts={[0, 1]}
                    scope='global'
                    setScope={() => {}}
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
});
