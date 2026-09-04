import { useHotkeys } from 'react-hotkeys-hook';
import { usePlayback } from '../hooks/PlaybackProvider';
import { useWorkDocument } from '../hooks/WorkDocument';
import { useCallSelection } from '../hooks/CallSelection';

interface EditorHotkeysProps {
    onSave: () => void;
    onOpen: () => void;
}

/**
 * The editor's keyboard, in one place.
 *
 * A component rather than a few `useHotkeys` calls in `App`, because most of these need
 * `usePlayback`, `useWorkDocument` or `useCallSelection`, and `App` *renders* those providers so
 * cannot read them. This sits inside them, beside `PinchZoomHandler` and `FollowPlayback`, which
 * are render-null components for the same reason.
 *
 * One file so that something answers "what keys does the editor have", and so that no binding
 * exists only while a toolbar happens to be mounted.
 *
 * ## Backspace
 *
 * Removes the selected calls, on whichever desk selected them. The library leaves the key to a
 * focused text field on its own, and the skyline, whose Backspace deletes selected boxes, stops
 * the press once it has acted on one — so one key never takes a box and a call together. The
 * default is cancelled only when there is something to remove; an idle Backspace stays the
 * browser's.
 *
 * ## `mod+`, not `meta+`
 *
 * `mod+` is meta on a Mac and ctrl elsewhere. Bound to `meta+` alone, Ctrl-S on Windows and
 * Linux saves the browser's copy of the page and Ctrl-O opens a file into the browser rather
 * than into the editor. `src/utils/shortcut.ts` makes the same test the library makes, so a
 * tooltip hint cannot drift from its binding.
 */
export const EditorHotkeys = ({ onSave, onOpen }: EditorHotkeysProps) => {
    const { undo, redo } = useWorkDocument();
    const { isPlaying, play, stop } = usePlayback();
    const { activeCallIds, removeActiveCalls } = useCallSelection();

    useHotkeys('mod+z', undo, { preventDefault: true }, [undo]);
    useHotkeys('mod+shift+z', redo, { preventDefault: true }, [redo]);
    useHotkeys('mod+s', onSave, { preventDefault: true }, [onSave]);
    useHotkeys('mod+o', onOpen, { preventDefault: true }, [onOpen]);

    useHotkeys(
        ['backspace', 'delete'],
        (event) => {
            if (activeCallIds.size === 0) return;
            event.preventDefault();
            removeActiveCalls();
        },
        [activeCallIds, removeActiveCalls],
    );

    useHotkeys(
        'space',
        () => {
            if (isPlaying) stop();
            else play();
        },
        {
            preventDefault: true,
            /**
             * Space is how a focused button is activated, and the library's skip-list covers
             * form tags and widget roles but not `button` — MUI's `ButtonBase` renders a real
             * `<button>` and only sets `role` when it is asked to render something else. So
             * clicking Insert and then pressing Space started playback instead of inserting
             * again, and `preventDefault: true` swallowed the button's own activation on the
             * way past.
             *
             * `ignoreEventWhen` rather than a guard inside the handler, because the library
             * evaluates this *before* it applies `preventDefault` and evaluates `enabled`
             * *after*. It is the only hook of the three that stops the key being eaten.
             * Dropping `preventDefault: true` and calling it by hand in the handler would work
             * too, but then Space scrolls the page every time the guard passes and the handler
             * decides not to act.
             */
            ignoreEventWhen: (event) =>
                event.target instanceof Element &&
                event.target.closest(
                    // `[role="combobox"]` is the scope picker, and it is not covered by any of
                    // the others: MUI renders a `Select`'s display node as a `<div>` with that
                    // role and a `tabindex`, so it is neither a `button` nor on the library's own
                    // skip-list — which matches tag names and roles but knows nothing of
                    // `combobox`. MUI answers Space there by opening the menu and calls
                    // `preventDefault` but never `stopPropagation`, so without this the two fire
                    // together: pick a part, press the Play shortcut the tooltip advertises, and
                    // the dropdown reopens *while* playback starts.
                    'button, summary, [role="button"], [role="combobox"], [role="listbox"], [contenteditable="true"]',
                ) !== null,
        },
        [isPlaying, play, stop],
    );

    return null;
};
