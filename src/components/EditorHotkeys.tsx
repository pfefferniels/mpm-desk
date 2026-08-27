import { useHotkeys } from 'react-hotkeys-hook';
import { usePlayback } from '../hooks/PlaybackProvider';
import { useWorkDocument } from '../hooks/WorkDocument';

interface EditorHotkeysProps {
    onSave: () => void;
    onOpen: () => void;
}

/**
 * The editor's keyboard, in one place.
 *
 * A component rather than a few `useHotkeys` calls in `App`, because two of the five need
 * `usePlayback` and `useWorkDocument` and `App` is what *renders* both providers — it cannot
 * read them. So this sits inside them, beside `PinchZoomHandler` and `FollowPlayback`, which
 * are render-null components for the same reason.
 *
 * It is also worth having as one file for its own sake. Three of these lived in `AppMenu`,
 * where they existed only while a toolbar happened to be mounted, and the other two lived in
 * `App` — so nothing anywhere answered "what keys does the editor have".
 *
 * ## `mod+`, not `meta+`
 *
 * The two that came from `AppMenu` were bound to the Command key alone. On Windows and Linux
 * that meant Ctrl-S saved the browser's copy of the page and Ctrl-O opened a file into the
 * browser rather than into the editor, while undo and redo — bound `mod+` from the start —
 * worked everywhere. `mod+` is meta on a Mac and ctrl elsewhere, and `src/utils/shortcut.ts`
 * makes the same test the library makes, so a tooltip hint cannot drift from its binding.
 */
export const EditorHotkeys = ({ onSave, onOpen }: EditorHotkeysProps) => {
    const { undo, redo } = useWorkDocument();
    const { isPlaying, play, stop } = usePlayback();

    useHotkeys('mod+z', undo, { preventDefault: true }, [undo]);
    useHotkeys('mod+shift+z', redo, { preventDefault: true }, [redo]);
    useHotkeys('mod+s', onSave, { preventDefault: true }, [onSave]);
    useHotkeys('mod+o', onOpen, { preventDefault: true }, [onOpen]);

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
