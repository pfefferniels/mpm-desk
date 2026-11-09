/**
 * Where the reconstruction of WM 225 is published.
 *
 * welte225.org holds the only copy, as the four files an archive of the editor is made of; this
 * repository bundles none. The viewer fetches them from there, and the tests and
 * `scripts/recordOutcomes.ts` work on a checkout of that repository, see `src/test/published.ts`.
 */
export const PUBLISHED = {
    mei: 'mpm/transcription.mei',
    work: 'mpm/work.json',
    performance: 'mpm/performance.mpm',
    score: 'mpm/score.msm',
} as const;

export type Published = keyof typeof PUBLISHED;

export const publishedUrl = (file: Published): string => `https://welte225.org/${PUBLISHED[file]}`;
