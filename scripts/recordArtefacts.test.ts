/**
 * The shipped reconstruction against the chain that produces it.
 *
 * `public/work.json`, `public/performance.mpm` and `public/score.msm` are a build output: the
 * viewer draws the tree from what they *record* rather than from a run, which is what lets it
 * carry no fitting code. So they go stale in silence — a fitter changes, nobody re-runs
 * `recordOutcomes.ts`, and what the viewer shows is a reconstruction the editor no longer
 * produces. Issue #37 caught that five days after it started.
 *
 * ## Compared byte for byte
 *
 * The chain writes the same document twice, so it can be: every id it mints is derived from what
 * it names (issue #48). The one exception is espressivo's own — it mints `meico_<uuid>` for an
 * element the MEI does not name, one `<marker>` of the 542 ids in this score — and those are
 * dropped, since nothing references them and nothing here can make them stable.
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
