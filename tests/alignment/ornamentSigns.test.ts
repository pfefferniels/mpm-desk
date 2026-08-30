// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ornamentSignsOf } from '../../src/mei/ornamentSigns'
import { getNotesFromMEI } from '../../src/score/scoreNotes'

const ornaments = readFileSync(join(__dirname, 'ornaments.mei'), 'utf-8')

describe('the ornament signs a score already writes', () => {
  it('finds a sign that names its note outright', () => {
    const signs = ornamentSignsOf(ornaments)

    expect(signs.get('trilled')?.map((s) => s.name)).toEqual(['trill'])
    expect(signs.get('morded')?.map((s) => s.name)).toEqual(['mordent'])
    expect(signs.get('turned')?.map((s) => s.name)).toEqual(['turn'])
  })

  it('leaves a note with no sign on it out of the map', () => {
    const signs = ornamentSignsOf(ornaments)

    expect(signs.has('plain')).toBe(false)
    expect(signs.has('slow1')).toBe(false)
  })

  it('spreads a sign written on a chord across every note of it', () => {
    const signs = ornamentSignsOf(
      ornaments.replace('<arpeg plist="#ch1"/>', '<arpeg startid="#ch1"/>')
    )

    expect(signs.get('ch1a')?.map((s) => s.name)).toEqual(['arpeg'])
    expect(signs.get('ch1c')?.map((s) => s.name)).toEqual(['arpeg'])
  })

  it('follows @plist, which is how an arpeggio names the chord it spreads', () => {
    // The fixture writes it this way, and so does the real NIFC Chopin
    const signs = ornamentSignsOf(ornaments)

    expect(signs.get('ch1a')?.map((s) => s.name)).toEqual(['arpeg'])
    expect(signs.get('ch1b')?.map((s) => s.name)).toEqual(['arpeg'])
    expect(signs.get('ch1c')?.map((s) => s.name)).toEqual(['arpeg'])
  })

  it('finds a sign that names a beat rather than a note', () => {
    // How most MusicXML conversions write it: @staff and @tstamp, no @startid
    const byTimestamp = ornaments.replace(
      '<trill startid="#trilled"/>',
      '<trill staff="1" tstamp="1"/>'
    )

    expect(ornamentSignsOf(byTimestamp).get('trilled')?.map((s) => s.name)).toEqual(['trill'])
  })

  it('keeps both signs where a note carries two', () => {
    const twice = ornaments.replace(
      '<trill startid="#trilled"/>',
      '<trill startid="#trilled"/><turn startid="#trilled"/>'
    )

    expect(ornamentSignsOf(twice).get('trilled')?.map((s) => s.name)).toEqual(['trill', 'turn'])
  })
})

/**
 * The fact the whole reading of extra notes rests on.
 *
 * Verovio's GenerateTimemapFunctor adds one entry per notated note and never
 * realises an ornament - the only expansion in its MIDI code is filled by
 * VisitBTrem alone. So the eight notes a performer plays against a written trill
 * meet a single score note, and seven of them reach the aligner as notes with
 * nothing in the score to match. If this ever stops being true, the
 * `written-ornament` reading stops being needed, and this test is what will say so.
 */
describe('what verovio makes of a written ornament', () => {
  let ids: string[]

  beforeAll(async () => {
    const notes = await getNotesFromMEI(ornaments, { collapseUnisons: false })
    ids = notes.map((note) => note.note)
  }, 60_000)

  it('gives a trilled note exactly one note, not the trill it stands for', () => {
    expect(ids.filter((id) => id === 'trilled')).toHaveLength(1)
  })

  it('does the same for a mordent and a turn', () => {
    expect(ids.filter((id) => id === 'morded')).toHaveLength(1)
    expect(ids.filter((id) => id === 'turned')).toHaveLength(1)
  })

  it('reads no note the score does not write', () => {
    const written = new Set(
      [...ornaments.matchAll(/<note\b[^>]*xml:id="([^"]+)"/g)].map((m) => m[1])
    )

    for (const id of ids) expect(written.has(id.replace(/-rend\d+$/, ''))).toBe(true)
  })
})
