import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where the reconstruction of WM 225 is published.
 *
 * welte225.org holds the only copy, as the four files an archive of the editor is made of; this
 * repository bundles none. The tests and `scripts/recordOutcomes.ts` work on a checkout of that
 * repository.
 */
const PUBLISHED = {
    mei: 'mpm/transcription.mei',
    work: 'mpm/work.json',
    performance: 'mpm/performance.mpm',
    score: 'mpm/score.msm',
} as const;

export type Published = keyof typeof PUBLISHED;

/**
 * The published files on disk: a checkout of welte225.org, the sibling directory unless
 * `WELTE225` says otherwise (CI checks the repository out inside the workspace).
 */
const checkout = resolve(process.env.WELTE225 ?? '../welte225.org');

export const publishedPath = (file: Published): string => {
    const path = resolve(checkout, PUBLISHED[file]);
    if (!existsSync(path)) {
        throw new Error(
            `${path} is missing: clone https://github.com/pfefferniels/welte225.org beside this repository, or set WELTE225 to a checkout of it`,
        );
    }
    return path;
};
