import { createContext, useContext, type ReactNode } from 'react';
import type { MidiFile } from 'midifile-ts';

/**
 * The recordings the score has been opened with, and the way one more is added.
 *
 * A third document beside the MEI and the work file, and the only one that is *evidence*: the MPM
 * is what somebody claims about the playing, the MEI says which note was played when, and this is
 * the playing. It has no other reader — the chain never sees it, because the alignment desk has
 * already written what it found into the MEI — so it is a context of its own rather than a field
 * on either of the other two.
 *
 * A `ViewProps` field would be wrong for the reason recorded in `TransformerViewProps.tsx`: that
 * bag is what the fit produced, and one desk's input does not belong in the other fourteen's.
 */
export interface Performance {
    /**
     * The `<recording @source>` this take is written under.
     *
     * Minted where the file does not name one, and then the document's: the same string an
     * `Align` call records, a `MakeChoice` selects by, and verovio lays out by.
     */
    source: string;
    /**
     * The file's own name, which is what the archive stores it under and what an `Align` records.
     *
     * Two files of the same name are therefore one file to the archive. The picker refuses the
     * second rather than overwriting the first — see `App`.
     */
    name: string;
    midi: MidiFile;
    /** The bytes as opened, which is what goes into the archive. Parsing is not reversible. */
    bytes: Uint8Array;
}

interface PerformancesValue {
    performances: readonly Performance[];
    /**
     * Read one more off disk and take it on, reporting whatever is wrong with it.
     *
     * The reading is `App`'s rather than the desk's because minting a `@source` needs to know
     * every take already in hand, and this is what holds them.
     */
    openPerformance: (file: File) => void;
}

const PerformancesContext = createContext<PerformancesValue | null>(null);

export const usePerformances = (): PerformancesValue => {
    const context = useContext(PerformancesContext);
    if (!context) throw new Error('usePerformances must be used within a PerformancesProvider');
    return context;
};

export const PerformancesProvider = ({
    value,
    children,
}: {
    value: PerformancesValue;
    children: ReactNode;
}) => <PerformancesContext value={value}>{children}</PerformancesContext>;
