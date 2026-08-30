// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getNotesFromMEI, type ScoreNote } from '../../src/score/scoreNotes'
import { loadVerovio } from '../../src/verovio/toolkit'

/**
 * Each score fixture ships as a pair — the file the excerpt was cut from, and the MEI verovio made
 * of it — so that the MEI can be re-derived. `fixtures/README.md` says which build made them, and
 * that build is no longer the one under `vendor/verovio`.
 *
 * This is what keeps that arrangement honest: it converts the sources with the *vendored* toolkit
 * and checks that the music comes out the same. Every fact the README states about a fixture — its
 * grace notes, its arpeggios, the four repaired B naturals — is a fact about the committed MEI, and
 * a rebuilt verovio that imported MusicXML differently would leave those claims describing a file
 * nobody could produce again.
 *
 * The note table rather than the bytes: the MEI verovio writes carries its own version string and
 * is free to reorder attributes, neither of which is what the fixtures are for.
 */

const load = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8')

/** Every fixture with a MusicXML source. The Humdrum one was made by another build; see the README. */
const PAIRS = ['chopin-op38-mm18-22', 'chopin-op38-mm40-46', 'mozart-kv279-mm30-35']

const table = (notes: readonly ScoreNote[]) =>
    notes.map((note) => `${note.note}:${String(note.onset)}:${String(note.duration)}:${String(note.pitch)}`)

describe('the score fixtures can still be re-derived', () => {
    for (const slug of PAIRS) {
        it(`${slug} comes back out of its MusicXML unchanged`, async () => {
            const toolkit = await loadVerovio()
            // Truthy, not `true`: the binding answers 1, whatever `@types/verovio` says. That is
            // also why `renderScore` writes `if (!toolkit.loadData(mei))`.
            expect(toolkit.loadData(load(`${slug}.musicxml`))).toBeTruthy()
            const rederived = toolkit.getMEI({ pageNo: 0, scoreBased: true })

            const options = { collapseUnisons: false, notatedOnsets: true }
            const committed = await getNotesFromMEI(load(`${slug}.mei`), options)
            const fresh = await getNotesFromMEI(rederived, options)

            expect(table(fresh)).toEqual(table(committed))
        }, 60_000)
    }
})
