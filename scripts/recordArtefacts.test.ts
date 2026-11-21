/**
 * The shipped reconstruction against the chain that produces it.
 *
 * `work.json`, `performance.mpm` and `score.msm`, as published on welte225.org, are a build
 * output: a reader takes what they *record* rather than running the chain. So they go stale in
 * silence, a fitter changing and nobody re-running `recordOutcomes.ts` (issue #37 caught that five
 * days after it started).
 *
 * Compared byte for byte, which the chain permits by deriving every id it mints from what that id
 * names (issue #48). The exception is espressivo's own `meico_<uuid>`, minted for an element the
 * MEI does not name, one `<marker>` of the 542 ids in this score; those are dropped, nothing
 * referencing them and nothing here being able to make them stable.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { performanceReading } from '../src/mei/performanceReading';
import { publishedPath, type Published } from '../src/test/published';
import { recordArtefacts } from './recordArtefacts';

/** The ids espressivo mints for the elements a conversion invents. */
const withoutMintedIds = (xml: string): string => xml.replace(/ xml:id="meico_[^"]*"/g, '');

const shipped = (file: Published) => readFileSync(publishedPath(file), 'utf-8');

describe('the published files are what the chain produces', () => {
    const recorded = recordArtefacts();

    test('the work file records the outcomes this chain reports', () => {
        expect(shipped('work')).toBe(recorded.work);
    });

    test('the performance is the one this chain writes, id for id', () => {
        expect(shipped('performance')).toBe(recorded.performance);
    });

    test('the score is the one this conversion makes of the MEI', () => {
        expect(withoutMintedIds(shipped('score'))).toBe(withoutMintedIds(recorded.score));
    });

    test('the score is the reading that was played: every note a recording sounds is in it', () => {
        // espressivo makes one note of notes tied together, under the id of one of them. The
        // ties are the played reading's: a tie the performer struck again is not one
        const played = new DOMParser().parseFromString(performanceReading(shipped('mei')), 'application/xml');
        const group = new Map<string, Set<string>>();
        const groupOf = (id: string): Set<string> => group.get(id) ?? new Set([id]);
        for (const tie of played.querySelectorAll('tie')) {
            const ends = ['startid', 'endid'].map((end) => (tie.getAttribute(end) ?? '').replace(/^#/, ''));
            const joined = new Set([...groupOf(ends[0]), ...groupOf(ends[1])]);
            for (const id of joined) group.set(id, joined);
        }

        // And a grace note is not in the score at all: espressivo hands those over beside it
        const graces = new Set(
            [...played.querySelectorAll('note')]
                .filter((note) => note.closest('[grace], graceGrp') !== null)
                .map((note) => note.getAttribute('xml:id')),
        );

        const inScore = new Set([...recorded.score.matchAll(/xml:id="([^"]+)"/g)].map((match) => match[1]));
        const sounded = [...shipped('mei').matchAll(/<when\b[^>]*\bdata="([^"]+)"/g)]
            .flatMap((match) => match[1].split(/\s+/).map((id) => id.replace(/^#/, '')))
            .filter((id) => !graces.has(id));
        expect(sounded.length).toBeGreaterThan(0);
        expect(sounded.filter((id) => ![...groupOf(id)].some((tied) => inScore.has(tied)))).toEqual([]);
    });
});
