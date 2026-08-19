import { useEffect, useState } from 'react';
import type { Reconstruction } from '../model/Reconstruction';

interface Work {
    /** The score as MSM XML — what a render performs. */
    scoreMsm: string;
    /** The performance as MPM XML — what the segments point into. */
    performanceMpm: string;
    reconstruction: Reconstruction;
}

/**
 * Load the three baked files that make up the piece.
 *
 * They are constants, produced together by `scripts/bakeSegments.ts`: the
 * segments name element ids that only that run's MPM contains, so they are
 * fetched as one unit and fail as one.
 */
export const useReconstruction = (): { work: Work | null; error: Error | null } => {
    const [work, setWork] = useState<Work | null>(null);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;

        const text = async (path: string) => {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
            return response.text();
        };

        Promise.all([text('/score.msm'), text('/performance.mpm'), text('/segments.json')])
            .then(([scoreMsm, performanceMpm, segments]) => {
                if (cancelled) return;
                setWork({
                    scoreMsm,
                    performanceMpm,
                    reconstruction: JSON.parse(segments) as Reconstruction,
                });
            })
            .catch(reason => {
                if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
            });

        return () => { cancelled = true; };
    }, []);

    return { work, error };
};
