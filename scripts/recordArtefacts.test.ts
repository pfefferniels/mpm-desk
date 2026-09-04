/**
 * The shipped reconstruction against the chain that produces it.
 *
 * `public/work.json`, `public/performance.mpm` and `public/score.msm` are a build output: the
 * viewer draws the tree from what they *record* rather than from a run, which is what lets it
 * carry no fitting code. So they go stale in silence, a fitter changing and nobody re-running
 * `recordOutcomes.ts` (issue #37 caught that five days after it started).
 *
 * Compared byte for byte, which the chain permits by deriving every id it mints from what that id
 * names (issue #48). The exception is espressivo's own `meico_<uuid>`, minted for an element the
 * MEI does not name, one `<marker>` of the 542 ids in this score; those are dropped, nothing
 * referencing them and nothing here being able to make them stable.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECORDED, recordArtefacts } from './recordArtefacts';

/** The ids espressivo mints for the elements a conversion invents. */
const withoutMintedIds = (xml: string): string => xml.replace(/ xml:id="meico_[^"]*"/g, '');

const shipped = (path: string) => readFileSync(path, 'utf-8');

describe('the files the viewer loads are what the chain produces', () => {
    const recorded = recordArtefacts();

    test('the work file records the outcomes this chain reports', () => {
        expect(shipped(RECORDED.work)).toBe(recorded.work);
    });

    test('the performance is the one this chain writes, id for id', () => {
        expect(shipped(RECORDED.performance)).toBe(recorded.performance);
    });

    test('the score is the one this conversion makes of the MEI', () => {
        expect(withoutMintedIds(shipped(RECORDED.score))).toBe(withoutMintedIds(recorded.score));
    });
});
