/**
 * The shipped reconstruction against the chain that produces it.
 *
 * `public/work.json`, `public/performance.mpm` and `public/score.msm` are a build output: the
 * viewer draws the tree from what they *record* rather than from a run, which is what lets it
 * carry no fitting code. So they go stale in silence — a fitter changes, nobody re-runs
 * `recordOutcomes.ts`, and what the viewer shows is a reconstruction the editor no longer
 * produces. Issue #37 caught that five days after it started.
 *
 * ## Ids are compared by what they point at, not by what they are
 *
 * Six places in the chain mint a `v4()` — an accentuation's id, an ornament def's *name*, a
 * dynamics instruction, a style switch — so two runs over the same input differ in a couple of
 * hundred ids and in nothing else (issue #48). Comparing them literally would fail on every run.
 *
 * They are canonicalised by first appearance instead, which keeps a reference honest: a `name.ref`
 * that stopped pointing at the def it named still differs, because the two ids canonicalise to
 * different positions. The MSM's ids are meico's own, minted for the elements a conversion invents
 * and referenced by nothing, so they are dropped — except the notes', which come from the MEI and
 * are what every `noteid` in the MPM resolves against.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECORDED, recordArtefacts } from './recordArtefacts';

const MINTED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Every minted id renamed to the position it first appears at. */
const canonical = (xml: string): string => {
    const seen = new Map<string, number>();
    return xml.replace(MINTED, (id) => {
        const known = seen.get(id) ?? seen.size;
        seen.set(id, known);
        return `minted_${String(known)}`;
    });
};

const withoutIds = (xml: string): string => xml.replace(/ xml:id="[^"]*"/g, '');

const noteIds = (xml: string): string[] =>
    [...xml.matchAll(/<note xml:id="([^"]+)"/g)].map((match) => match[1]);

const shipped = (path: string) => readFileSync(path, 'utf-8');

describe('the files the viewer loads are what the chain produces', () => {
    const recorded = recordArtefacts();

    test('the work file records the outcomes this chain reports', () => {
        expect(shipped(RECORDED.work)).toBe(recorded.work);
    });

    test('the performance is the one this chain writes', () => {
        expect(canonical(shipped(RECORDED.performance))).toBe(canonical(recorded.performance));
    });

    test('the score is the one this conversion makes of the MEI', () => {
        expect(withoutIds(shipped(RECORDED.score))).toBe(withoutIds(recorded.score));
        expect(noteIds(shipped(RECORDED.score))).toEqual(noteIds(recorded.score));
    });
});
