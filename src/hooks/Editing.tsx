import { createContext, useContext } from 'react';

/**
 * Whether the document on screen may be edited: true in the editor, false in the viewer.
 *
 * The viewer is the editor's desks with every gesture that writes taken away: the same plots,
 * the same selection, playback and zoom, so a reader can see what of the recording each curve was
 * fitted to. A desk asks this before it offers a gesture that would make or change a call, and
 * before it renders a toolbar control that would.
 *
 * True where nothing provides it, so a desk mounted on its own, as in a test, is the editor's.
 * `App` also refuses every edit to the document in the viewer, so a gesture a desk forgot to
 * withhold does nothing rather than editing a reconstruction nobody can save.
 */
export const EditingContext = createContext(true);

export const useEditable = (): boolean => useContext(EditingContext);
