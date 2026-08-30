// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getNotesFromMEI, type ScoreNote } from '../../src/score/scoreNotes'

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')
const moment = (note: ScoreNote) => `${note.onset}:${note.pitch}`

let collapsed: ScoreNote[]
let everything: ScoreNote[]

beforeAll(async () => {
  collapsed = await getNotesFromMEI(mei)
  everything = await getNotesFromMEI(mei, { collapseUnisons: false })
}, 60_000)

describe('the notes a score offers an aligner', () => {
  it('describes each note by id, onset, duration and pitch', () => {
    expect(collapsed.length).toBeGreaterThan(100)

    for (const note of collapsed) {
      expect(note.note).toMatch(/\S/)
      expect(note.onset).toBeGreaterThanOrEqual(0)
      expect(note.duration).toBeGreaterThan(0)
      expect(note.pitch).toBeGreaterThan(20)
    }

    // The ids are what an alignment is written against, so they have to be unique
    expect(new Set(collapsed.map((note) => note.note)).size).toBe(collapsed.length)
  })

  it('reads a unison as one note by default', () => {
    expect(new Set(collapsed.map(moment)).size).toBe(collapsed.length)
  })

  it('keeps both notes of a unison when asked to', () => {
    expect(everything.length).toBeGreaterThan(collapsed.length)
    expect(new Set(everything.map(moment)).size).toBe(collapsed.length)

    // Collapsing only ever drops notes, it never moves or invents one
    const kept = new Set(everything.map((note) => note.note))
    expect(collapsed.every((note) => kept.has(note.note))).toBe(true)
  })

  it('holds a tied note for the whole chain, not just its own length', () => {
    const doc = new DOMParser().parseFromString(mei, 'text/xml')
    const rows = new Map(everything.map((note) => [note.note, note]))
    /** The written length in quarters, dots included */
    const quarters = (element: Element | null) => {
      const dots = Number(element?.getAttribute('dots') ?? 0)
      return (4 / Number(element?.getAttribute('dur'))) * (2 - Math.pow(2, -dots))
    }

    const chains = [...doc.querySelectorAll('tie[startid][endid]')]
      .map((tie) => ({
        from: tie.getAttribute('startid')!.replace(/^#/, ''),
        to: tie.getAttribute('endid')!.replace(/^#/, ''),
      }))
      .filter(({ from, to }) => rows.has(from) && !rows.has(to))

    expect(chains.length).toBeGreaterThan(10)

    let checked = 0
    for (const { from, to } of chains) {
      const own = quarters(doc.querySelector(`[*|id="${from}"]`))
      const tied = quarters(doc.querySelector(`[*|id="${to}"]`))
      if (!Number.isFinite(own) || !Number.isFinite(tied)) continue

      // It sounds for both halves. The exact figure is verovio's, and the note it
      // reports on may be an editorial reading of the one written here, so what is
      // pinned is that the row outlasts the first note of its chain
      expect(rows.get(from)!.duration).toBeGreaterThan(own + 1e-9)
      checked++
    }

    expect(checked).toBeGreaterThan(10)
  })

  it('sounds a tied group once, for as long as the tie lasts', () => {
    const ids = new Set(everything.map((note) => note.note))
    const tied = [
      ...new DOMParser()
        .parseFromString(mei, 'text/xml')
        .querySelectorAll('tie[endid]'),
    ].map((tie) => tie.getAttribute('endid')!.replace(/^#/, ''))

    expect(tied.length).toBeGreaterThan(0)
    // A note another note is tied into is not sounded on its own
    expect(tied.filter((id) => ids.has(id))).toHaveLength(0)
  })
})
