import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isMigrated, migrateWork, migrateWorkText } from '../src/model/migrateWork.ts'
import type { Segment } from '../src/model/Work.ts'

/**
 * `public/info.json` is the reconstruction of Welte roll 225 — 494 calls across 136
 * argumentations, written in the JSON-LD shape this migration reads. It is the only input this
 * migration has ever had to handle, so the numbers below are measurements of it rather than
 * round figures: a change that moves one of them has changed the reconstruction, not the test.
 */
const source = readFileSync('public/info.json', 'utf8')
const old = JSON.parse(source) as {
    creation: {
        incorporates: string[]
        argumentations: {
            id: string
            note?: string
            continue?: string
            conclusion: { note?: string; motivation?: string; certainty?: string }
            calls: { id: string; name: string; created?: string[] }[]
        }[]
    }
    secondary: unknown
}
const argumentations = old.creation.argumentations
const oldCalls = argumentations.flatMap(a => a.calls)

const { work, report } = migrateWork(JSON.parse(source))
const segmentById = new Map(work.segments.map(segment => [segment.id, segment]))

describe('the shipped reconstruction, migrated', () => {
    it('keeps every call, in order, with its id and options', () => {
        expect(report.calls).toBe(494)
        expect(work.provenance).toHaveLength(oldCalls.length)
        expect(work.provenance.map(call => call.id)).toEqual(oldCalls.map(call => call.id))
        expect(work.provenance.map(call => call.name)).toEqual(oldCalls.map(call => call.name))
    })

    it('carries the Set and Map envelopes through untouched', () => {
        // 87 of them. A reviver on the way in without a replacer on the way out turns each into
        // `{}` — silently, in a file nobody reads by eye.
        const envelopes = (text: string) => (text.match(/"dataType"/g) ?? []).length
        expect(envelopes(source)).toBe(87)
        expect(envelopes(migrateWorkText(source).text)).toBe(87)
    })

    it('makes one segment per argumentation, keeping its id', () => {
        expect(report.segments).toBe(136)
        expect(work.segments.map(segment => segment.id)).toEqual(argumentations.map(a => a.id))
    })

    it('partitions the provenance: every call in exactly one segment', () => {
        const claimed = work.segments.flatMap(segment => segment.calls)
        expect(claimed).toHaveLength(work.provenance.length)
        expect(new Set(claimed).size).toBe(claimed.length)
        expect(new Set(claimed)).toEqual(new Set(work.provenance.map(call => call.id)))
    })

    it('records what each call wrote, on the call', () => {
        const createdById = new Map(oldCalls.map(call => [call.id, call.created ?? []]))
        for (const call of work.provenance) {
            const created = createdById.get(call.id) ?? []
            expect(call.elements ?? [], `call ${call.id}`).toEqual(created)
        }
        expect(report.elements).toBe(659)
        // Three `<tempo>` elements are named by two InsertTempo calls of one segment each.
        expect(report.duplicateElements).toBe(3)
    })

    it('leaves secondary byte-identical', () => {
        expect(JSON.stringify(work.secondary)).toBe(JSON.stringify(old.secondary))
    })
})

describe('what the ontology carried that is now dropped', () => {
    /**
     * `motivation` and `certainty` do not survive the migration, and that is the decision rather
     * than an omission.
     *
     * Both were retired upstream before this migration existed — espressivo's `work.ts` dropped
     * them because nothing read them, and the viewer removed `certainty` from data and code in one
     * commit. A six-value enum was a worse version of the prose 96 of the 136 groups already
     * carry. This asserts they are gone, so that reinstating one has to be a decision somebody
     * comes here and makes.
     */
    it('drops certainty, and spends motivation into the note before dropping it', () => {
        const { work: dropped } = migrateWork(JSON.parse(source));
        const keys = new Set(dropped.segments.flatMap((segment) => Object.keys(segment)));
        expect(keys.has('motivation')).toBe(false);
        expect(keys.has('certainty')).toBe(false);

        // The point of spending rather than deleting: EVERY segment says something afterwards.
        // Deleting the field and the viewer's placeholder table together would have left the
        // forty groups that had no prose of their own with no word at all.
        expect(dropped.segments.every((segment) => (segment.note ?? '').trim().length > 0)).toBe(
            true,
        );
        expect(dropped.segments).toHaveLength(136);
    });

    it('leaves a group that named itself alone, and words the forty that did not', () => {
        const { work: dropped } = migrateWork(JSON.parse(source));
        const stated = new Set(
            argumentations.map((a) => (a.conclusion.note ?? '').trim()).filter(Boolean),
        );
        const filled = dropped.segments.filter((segment) => !stated.has(segment.note ?? ''));

        expect(filled).toHaveLength(40);
        expect(dropped.segments.length - filled.length).toBe(96);

        const words: Record<string, number> = {};
        for (const segment of filled) words[segment.note ?? ''] = (words[segment.note ?? ''] ?? 0) + 1;
        expect(words).toEqual({
            Intensivieren: 12,
            Beruhigen: 9,
            Zurücknehmen: 8,
            Unbestimmt: 8,
            Bewegen: 3,
        });
    });
});

describe('what the ontology carried that is still read', () => {
    it('takes note from the conclusion, where the gesture words are', () => {
        // 136 now, not 96: the forty groups that stated nothing are worded from their motivation
        // before it is dropped, so every segment carries one. The check below is that a group
        // which DID state something keeps exactly what it stated, untouched by that backfill.
        expect(report.segmentsWithNote).toBe(136)
        for (const a of argumentations) {
            const stated = a.conclusion.note?.trim()
            if (!stated) continue
            expect(segmentById.get(a.id)?.note, `segment ${a.id}`).toBe(stated)
        }
        const notes = work.segments.map(segment => segment.note ?? '').join('\n')
        expect(notes).toContain('schattieren')
        expect(notes).toContain('Hineinfallen')
        expect(notes).toContain('Nachlauschen')
    })

    it('keeps the editorial prose apart, under commentary', () => {
        expect(report.segmentsWithCommentary).toBe(3)
        const commentaries = work.segments.flatMap(segment => segment.commentary ?? [])
        expect(commentaries.some(commentary => commentary.includes('Welte-Systems'))).toBe(true)
        // The long one is apparatus, not a label: it would make one branch of the tree a
        // paragraph if it went into `note`.
        expect(Math.max(...commentaries.map(commentary => commentary.length))).toBeGreaterThan(100)
    })



    it('turns continue into a link that resolves to another segment', () => {
        expect(report.segmentsWithContinues).toBe(13)
        const links = work.segments.filter(
            (segment): segment is Segment & { continues: string } => segment.continues !== undefined,
        )
        for (const segment of links) {
            expect(segmentById.has(segment.continues), `${segment.id} -> ${segment.continues}`).toBe(true)
            expect(segment.continues).toBe(argumentations.find(a => a.id === segment.id)?.continue)
        }
        // Two segments name the same predecessor, so it is a forest and not a chain.
        expect(new Set(links.map(segment => segment.continues)).size).toBe(12)
    })
})

describe('what it drops', () => {
    it('drops incorporates only because MakeChoice already says it', () => {
        expect(report.incorporates).toEqual(old.creation.incorporates)
        const preferred = work.provenance
            .filter(call => call.name === 'MakeChoice')
            .map(call => call.options['prefer'])
        expect(preferred).toEqual(old.creation.incorporates)
    })

    it('refuses to drop an incorporates no MakeChoice call prefers', () => {
        const orphaned = JSON.parse(source) as { creation: { incorporates: string[] } }
        orphaned.creation.incorporates = ['a-recording-nothing-chose']
        expect(() => migrateWork(orphaned)).toThrow(/not derivable/)
    })

    it('keeps no JSON-LD plumbing', () => {
        const text = migrateWorkText(source).text
        expect(text).not.toContain('@context')
        expect(text).not.toContain('simpleArgumentation')
        expect(text).not.toContain('"creation"')
        // The belief ids went with the graph: nothing ever referenced one.
        expect(text).not.toContain('belief-')
    })
})

describe('the migration is a one-way door that can be walked twice', () => {
    it('hands an already-migrated file straight back', () => {
        const once = migrateWorkText(source).text
        const twice = migrateWorkText(once)
        expect(twice.text).toBe(once)
        expect(twice.report.alreadyMigrated).toBe(true)
        expect(twice.report.calls).toBe(494)
        expect(twice.report.segments).toBe(136)
    })

    it('knows which shape it is looking at', () => {
        expect(isMigrated(JSON.parse(source))).toBe(false)
        expect(isMigrated(work)).toBe(true)
        expect(() => isMigrated({ ...work, creation: {} })).toThrow(/neither shape/)
    })
})

describe('what the file may name that this build cannot run', () => {
    it('names a call whose transformer is no longer registered', () => {
        // None in the shipped file; the check is for the next one.
        expect(report.retiredCalls).toEqual([])
        expect(report.transformerNames).toHaveLength(14)

        // Not the `MakeChoice` call — renaming that one takes the incorporates derivation with
        // it, and the run fails on a different guard before reaching this one.
        const retired = JSON.parse(source) as typeof old
        const victim = retired.creation.argumentations
            .flatMap(a => a.calls)
            .find(call => call.name === 'InsertRubato')
        expect(victim).toBeDefined()
        victim!.name = 'CombineAdjacentRubatos'

        expect(migrateWork(retired).report.retiredCalls).toEqual([
            { id: victim!.id, name: 'CombineAdjacentRubatos' },
        ])
    })
})

describe('a call may not belong to two segments', () => {
    it('refuses a file where one does', () => {
        const doubled = JSON.parse(source) as typeof old
        doubled.creation.argumentations[1].calls.push(doubled.creation.argumentations[0].calls[0])
        expect(() => migrateWork(doubled)).toThrow(/appears in more than one argumentation/)
    })

    it('refuses a continue that resolves to nothing', () => {
        const dangling = JSON.parse(source) as typeof old
        dangling.creation.argumentations[0].continue = 'argumentation-never-written'
        expect(() => migrateWork(dangling)).toThrow(/is not an argumentation in this file/)
    })
})
