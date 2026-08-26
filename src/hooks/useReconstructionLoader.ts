import { useEffect, useState } from 'react';
import type { Reconstruction } from '../model/Reconstruction';
import { outcomesOf, projectReconstruction } from '../model/Reconstruction';
import { parseWorkFile } from '../model/Work';
import { readPerformance } from '../utils/mpm';
import { readMeter } from '../utils/score';

interface Work {
    /** The score as MSM XML — what a render performs. */
    scoreMsm: string;
    /** The performance as MPM XML — what the segments point into. */
    performanceMpm: string;
    /**
     * The chain as it was fetched, verbatim.
     *
     * `reconstruction` is a projection of it and cannot be turned back into it, so the text is
     * kept: it is what the download hands on, and what lets the editor open what the viewer shows.
     */
    workJson: string;
    reconstruction: Reconstruction;
}

/**
 * Load the three files that make up the piece.
 *
 * Three, not four: the projection the tree draws is derived here rather than shipped beside them.
 * `work.json` already carries the grouping — each call names the segment it was made under —
 * and every call records what it wrote and where, so a
 * `segments.json` holding the projection would be the same facts twice, free to disagree with
 * them. Deriving it costs a few milliseconds.
 *
 * Deriving it needs no fitting code. `Call.elements` and `Call.range` are written by the editor on
 * save (`scripts/recordOutcomes.ts` does the same for a file edited elsewhere), and the element
 * types come off the MPM the viewer is already parsing.
 */
export const useReconstruction = (): { work: Work | null; error: Error | null } => {
    const [work, setWork] = useState<Work | null>(null);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;

        const text = async (path: string) => {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`${path}: ${String(response.status)} ${response.statusText}`);
            return response.text();
        };

        Promise.all([text('/score.msm'), text('/performance.mpm'), text('/work.json')])
            .then(([scoreMsm, performanceMpm, workJson]) => {
                if (cancelled) return;

                const file = parseWorkFile(workJson);
                const performance = readPerformance(performanceMpm, readMeter(scoreMsm));
                const elementTypes = new Map(
                    performance.instructions.map((instruction) => [instruction.id, instruction.type]),
                );

                const { reconstruction } = projectReconstruction({
                    title: file.name,
                    author: '',
                    claims: file.segments,
                    outcomes: outcomesOf(file.provenance),
                    elementTypes,
                });

                setWork({ scoreMsm, performanceMpm, workJson, reconstruction });
            })
            .catch((reason: unknown) => {
                if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return { work, error };
};
