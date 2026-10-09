import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SecondaryData } from '../desks/TransformerViewProps';
import type { Alignment } from '../fitting/alignment';
import type { FitResult } from '../fitting/fit';
import type { Mpm } from '../fitting/instructions/index';
import { buildWorkArchive } from '../model/exportWork';
import type { WorkFile } from '../model/Work';
import type { WorkMetadata } from '../model/workReducer';
import { documentSlug, downloadAsFile } from '../utils/utils';
import type { Performance } from './Performances';

interface UnsavedChanges {
    /** Whether the document differs from the one last written out. */
    dirty: boolean;
    /** Note that this document is the one on disk, as a freshly opened or saved one is. */
    markSaved: (work: WorkFile) => void;
}

/** Whether there is anything to lose, and a warning on reload while there is. */
export const useUnsavedChanges = (work: WorkFile): UnsavedChanges => {
    /**
     * The document as it was last written out.
     *
     * Dirtiness is `work !== savedWork`, by reference. Sound because `workHistoryReducer` hands
     * back the state it was given when an edit changed nothing, because `load` stores the very
     * object it dispatched, and because undo and redo step between objects the history already
     * holds, so saving, undoing and redoing back lands on the saved reference again.
     */
    const [savedWork, setSavedWork] = useState<WorkFile>(work);
    const dirty = work !== savedWork;

    /**
     * Warn on reload, but only when there is something to lose. Asking unconditionally, straight
     * after a save included, is the fastest way to teach somebody to click through the dialog.
     */
    useEffect(() => {
        if (!dirty) return;

        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            // Safari still wants the legacy assignment.
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', warn);
        return () => {
            window.removeEventListener('beforeunload', warn);
        };
    }, [dirty]);

    return { dirty, markSaved: setSavedWork };
};

interface UseSaveWorkParams {
    work: WorkFile;
    mei: string | undefined;
    mpm: Mpm | null;
    alignment: Alignment | null;
    result: FitResult | null;
    scoreMsm: string;
    metadata: WorkMetadata;
    secondary: SecondaryData;
    performances: readonly Performance[];
    /** The document just written out is now the one on disk. */
    onSaved: (work: WorkFile) => void;
}

/**
 * Save, which is a download: the four-file archive the viewer reads.
 *
 * Here rather than in the toolbar because the shortcut calls it too, from a different subtree.
 */
export const useSaveWork = ({
    work,
    mei,
    mpm,
    alignment,
    result,
    scoreMsm,
    metadata,
    secondary,
    performances,
    onSaved,
}: UseSaveWorkParams): (() => void) => {
    /**
     * What to call the archive. The slug itself is `documentSlug`, shared with the markup desk's
     * MIDI render — the two files are the same document under two extensions, and the reasoning
     * about a title that is prose belongs in one place.
     */
    const archiveName = useMemo(() => `${documentSlug(metadata.title)}.zip`, [metadata.title]);

    /**
     * `buildWorkArchive` is the pure, tested half. This is the rest: the download itself, and
     * noticing that the document on disk is now this one.
     */
    const handleSave = useCallback(async () => {
        if (!mei || !mpm || !alignment || !result) return;

        const archive = await buildWorkArchive({
            mei,
            msm: alignment,
            mpm,
            scoreMsm,
            calls: work.provenance,
            segments: work.segments,
            outcomes: result.outcomes,
            metadata,
            // The same boundary `setSecondary` in `App` crosses in the other direction, and the
            // only other place it is crossed: the bag is typed per desk here and opaque to the
            // document, because nothing outside a desk may depend on its shape.
            secondary: secondary as WorkFile['secondary'],
            recordings: performances.map(({ name, bytes }) => ({ name, bytes })),
        });

        downloadAsFile(archive, archiveName, 'application/zip');
        onSaved(work);
    }, [
        mei,
        mpm,
        alignment,
        result,
        scoreMsm,
        work,
        metadata,
        secondary,
        archiveName,
        performances,
        onSaved,
    ]);

    return useCallback(() => void handleSave(), [handleSave]);
};
