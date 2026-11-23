import { createContext, useContext, useMemo, type ReactNode } from 'react';

/** Notes a reader follows back to Base Text, and the date they are struck at. */
export interface Followed {
    /** The `xml:id`s of the score notes, as Base Text draws a brace over each. */
    readonly notes: readonly string[];
    /** Where they are struck, in ticks, which is what the open desk is scrolled to. */
    readonly date: number;
}

interface FollowBackValue {
    /**
     * Open Base Text at the notes. Absent in the editor, where a click on a note has its own work
     * to do, and where Base Text cannot be opened, as in a document with one reading.
     */
    follow?: (followed: Followed) => void;
    /** The notes last followed while Base Text is open, which it marks; `null` anywhere else. */
    followed: Followed | null;
}

const FollowBackContext = createContext<FollowBackValue>({ followed: null });

/**
 * Following a note back to the roll, in the viewer.
 *
 * Every desk draws what a call made of the notes, and Base Text draws the readings they were taken
 * from, each a link to the symbol of the roll that sounds it. A note clicked on another desk opens
 * Base Text at it, so that a curve, a box or a dot can be followed back through the take to the
 * perforation that made it.
 *
 * Outside a provider nothing follows, so a desk mounted on its own behaves as the editor's does.
 */
export const useFollowBack = (): FollowBackValue => useContext(FollowBackContext);

interface FollowBackProviderProps extends FollowBackValue {
    children: ReactNode;
}

export const FollowBackProvider = ({ follow, followed, children }: FollowBackProviderProps) => {
    const value = useMemo(() => ({ follow, followed }), [follow, followed]);
    return <FollowBackContext value={value}>{children}</FollowBackContext>;
};
