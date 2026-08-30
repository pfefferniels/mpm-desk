// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getNotesFromMEI, type ScoreNote } from '../../src/score/scoreNotes'

const load = (path: string) => readFileSync(join(__dirname, path), 'utf-8')
const byId = (notes: ScoreNote[]) => new Map(notes.map((note) => [note.note, note]))

const read = async (path: string, notatedOnsets: boolean) =>
  byId(await getNotesFromMEI(load(path), { collapseUnisons: false, notatedOnsets }))

const idsOf = (mei: string, selector: string) => {
  const doc = new DOMParser().parseFromString(mei, 'application/xml')
  return [...doc.querySelectorAll(selector)].flatMap((element) =>
    (element.localName === 'note' ? [element] : [...element.querySelectorAll('note')]).map(
      (note) => note.getAttribute('xml:id')!
    )
  )
}

// Real music, converted from MusicXML and so carrying the @dur.ppq that says what
// the score writes. See test/fixtures/README.md.
describe('a score that says what it writes', () => {
  const chopin = 'fixtures/chopin-op38-mm18-22.mei'
  const chopinTies = 'fixtures/chopin-op38-mm40-46.mei'
  const mozart = 'fixtures/mozart-kv279-mm30-35.mei'

  let played: Map<string, ScoreNote>
  let written: Map<string, ScoreNote>

  beforeAll(async () => {
    played = await read(chopin, false)
    written = await read(chopin, true)
  }, 60_000)

  it('puts a grace note verovio plays early back on its beat', () => {
    const graces = idsOf(load(chopin), '[grace]')
    expect(graces.length).toBeGreaterThan(0)

    for (const id of graces) {
      // Verovio leans the grace in front of the beat; the score writes it on one
      expect(played.get(id)!.onset % 0.25).toBeGreaterThan(0)
      expect(written.get(id)!.onset % 0.25).toBe(0)
      expect(written.get(id)!.duration).toBe(0)
    }
  })

  it('holds a grace tied into its principal for the whole tie', async () => {
    const tied = await read(chopinTies, true)
    const asPlayed = await read(chopinTies, false)
    const mei = load(chopinTies)
    const doc = new DOMParser().parseFromString(mei, 'application/xml')

    const tiedGraces = idsOf(mei, '[grace]').filter((id) =>
      doc.querySelector(`tie[startid="#${id}"]`)
    )
    expect(tiedGraces.length).toBe(6)

    for (const id of tiedGraces) {
      // The tie is held either way; what the notated reading adds is the beat the
      // grace is written on, rather than the place verovio leans it in front of
      expect(asPlayed.get(id)!.duration).toBeGreaterThan(1)
      expect(asPlayed.get(id)!.onset % 1).toBeGreaterThan(0)

      expect(tied.get(id)!.onset).toBe(18)
      expect(tied.get(id)!.duration).toBe(3)
    }
  })

  it('gives an arpeggiated chord a single onset', async () => {
    const mei = load(mozart)
    const doc = new DOMParser().parseFromString(mei, 'application/xml')
    const arpeggios = [...doc.querySelectorAll('arpeg')]
    expect(arpeggios.length).toBeGreaterThan(0)

    const notes = await read(mozart, true)
    for (const arpeg of arpeggios) {
      const members = (arpeg.getAttribute('plist') ?? '')
        .split(/\s+/)
        .map((reference) => reference.replace(/^#/, ''))
        .filter(Boolean)
        .flatMap((id) => idsOf(mei, `[*|id="${id}"]`).concat(id))
        .map((id) => notes.get(id))
        .filter((note): note is ScoreNote => note !== undefined)

      expect(members.length).toBeGreaterThan(1)
      expect(new Set(members.map((member) => member.onset)).size).toBe(1)
    }
  })

  it('leaves an ordinary note where it already stood', () => {
    const ornamented = new Set(idsOf(load(chopin), '[grace]'))

    for (const [id, note] of written) {
      if (ornamented.has(id)) continue
      expect(note.onset).toBeCloseTo(played.get(id)!.onset, 6)
    }
  })

  /**
   * The one thing above that is not a fact about music: a rest before a note has to be counted
   * before it. The walk used to be `layer.querySelectorAll("note, chord, rest, space, …")`, which
   * a browser answers in tree order and jsdom answers grouped by selector — so a layer written
   * `<space/><note/><note/><note/>` came back note, note, note, space and the notes landed half a
   * beat early. It moved eight notes of this fixture and nothing else noticed.
   *
   * Checked at the note rather than on the walk, because it is the onsets that have to be right.
   */
  it('counts a rest that stands before a note before it', () => {
    const doc = new DOMParser().parseFromString(load(chopin), 'application/xml')

    const leading = [...doc.querySelectorAll('layer')].flatMap((layer) => {
      const [first, second] = [...layer.children]
      return first?.localName === 'space' && second?.localName === 'note'
        ? [{ rest: Number(first.getAttribute('dur.ppq')), id: second.getAttribute('xml:id')! }]
        : []
    })
    expect(leading.length).toBeGreaterThan(0)

    // ppq is 16 here, and each such layer opens its measure — so the note stands the rest's own
    // length into the bar rather than on its first beat.
    for (const { rest, id } of leading) {
      const onset = written.get(id)!.onset
      expect(onset % 3).toBeCloseTo(rest / 16, 6)
    }
  })
})

// A score written as MEI by hand, which carries no notated timing at all
describe('a score that does not say what it writes', () => {
  const ornaments = 'ornaments.mei'

  it('says so, and leaves the played timing alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const played = await read(ornaments, false)
    const written = await read(ornaments, true)

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()

    // Only the arpeggio can be put right from the markup; everything else keeps
    // the onset verovio would play it at
    for (const id of ['trilled', 'morded', 'turned', 'tremmed', 'plain', 'slow1', 'slow4']) {
      expect(written.get(id)).toEqual(played.get(id))
    }
  })

  it('still unrolls an arpeggio, which the markup alone describes', async () => {
    const written = await read(ornaments, true)
    const members = ['ch1a', 'ch1b', 'ch1c'].map((id) => written.get(id)!)

    for (const member of members) {
      expect(member.onset).toBe(2)
      expect(member.duration).toBe(2)
    }
  })
})
