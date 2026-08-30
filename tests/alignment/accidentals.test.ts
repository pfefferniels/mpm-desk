// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { impliedAlterations } from '../../src/score/accidentals'
import { getNotesFromMEI, type ScoreNote } from '../../src/score/scoreNotes'

const load = (path: string) => readFileSync(join(__dirname, path), 'utf-8')
const parse = (mei: string) => new DOMParser().parseFromString(mei, 'application/xml')
const alterations = (mei: string) => Object.fromEntries(impliedAlterations(parse(mei)))

/** A score of one staff, so that a probe is the key signature and the notes and nothing else */
const score = (keySig: string, measures: string, staffDefs?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="6.0-dev">
  <music><body><mdiv><score>
    <scoreDef><staffGrp>${
      staffDefs ??
      `<staffDef n="1" lines="5"><clef shape="G" line="2"/>${keySig}<meterSig count="4" unit="4"/></staffDef>`
    }</staffGrp></scoreDef>
    <section>${measures}</section>
  </score></mdiv></body></music>
</mei>`

const measure = (layers: string, n = 1) => `<measure n="${n}">${layers}</measure>`
const staff = (layer: string, n = 1) => `<staff n="${n}"><layer n="1">${layer}</layer></staff>`
const note = (id: string, pname: string, oct: number, attributes = '') =>
  `<note xml:id="${id}" dur="4" oct="${oct}" pname="${pname}" ${attributes}/>`

describe('the alteration a key signature implies', () => {
  it('is taken by every octave of the pitches the signature names', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('b5', 'b', 5) + note('b2', 'b', 2) + note('c', 'c', 4) + note('f', 'f', 4)))
    )

    // B flat minor lowers b, e, a, d and g, and leaves c and f alone
    expect(alterations(mei)).toEqual({ b5: -1, b2: -1 })
  })

  it('goes the other way for sharps, in the order sharps are added', () => {
    const mei = score(
      '<keySig sig="3s"/>',
      measure(staff(note('f', 'f', 4) + note('c', 'c', 5) + note('g', 'g', 4) + note('d', 'd', 4)))
    )

    expect(alterations(mei)).toEqual({ f: 1, c: 1, g: 1 })
  })

  it('is nothing at all for a signature of none', () => {
    const mei = score('<keySig sig="0"/>', measure(staff(note('b', 'b', 4))))

    expect(alterations(mei)).toEqual({})
  })
})

describe('a note that says what it sounds as', () => {
  it('is left to verovio, which has already applied it', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('written', 'b', 4, 'accid="n"') + note('gestural', 'e', 4, 'accid.ges="f"')))
    )

    expect(alterations(mei)).toEqual({})
  })

  it('says it through a child <accid> just as well', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(`<note xml:id="child" dur="4" oct="4" pname="b"><accid accid="n"/></note>`))
    )

    expect(alterations(mei)).toEqual({})
  })

  it('counts an <accid> that states nothing, because verovio gets nothing out of it', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(`<note xml:id="empty" dur="4" oct="4" pname="b"><accid/></note>` + note('after', 'b', 4)))
    )

    // The note sounds natural, and so does the one that inherits from it
    expect(alterations(mei)).toEqual({})
  })

  it('is @accid.ges before @accid, the order verovio reads them in', () => {
    // Verovio sounds this note as B sharp; the one after it takes the same
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('stated', 'b', 4, 'accid.ges="s" accid="f"') + note('after', 'b', 4)))
    )

    expect(alterations(mei)).toEqual({ after: 1 })
  })

  it('is left alone when it states a pitch outright, which verovio takes as it stands', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('numbered', 'b', 4, 'pnum="70"') + note('gestural', 'b', 4, 'pname.ges="a"')))
    )

    expect(alterations(mei)).toEqual({})
  })
})

describe('an accidental written in the music', () => {
  it('carries to the end of its measure and no further', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('marked', 'b', 4, 'accid="n"') + note('same', 'b', 4) + note('lower', 'b', 3))) +
        measure(staff(note('next', 'b', 4)), 2)
    )

    // `same` follows the natural, `lower` is another octave and `next` another measure
    expect(alterations(mei)).toEqual({ lower: -1, next: -1 })
  })

  it('carries whatever it was, double flats included', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('marked', 'b', 4, 'accid="ff"') + note('after', 'b', 4)))
    )

    expect(alterations(mei)).toEqual({ after: -2 })
  })

  it('carries forwards in sounding time, not in the order the layers are written', () => {
    // The shape of m. 24 of the app's own transcription: the upper voice sharpens
    // an f on the last beat, the lower voice holds an f from the first
    const mei = score(
      '',
      measure(
        `<staff n="1"><layer n="1">${note('early', 'g', 4) + note('sharpened', 'f', 4, 'accid="s"')}</layer>` +
          `<layer n="2">${note('held', 'f', 4) + note('later', 'f', 4)}</layer></staff>`
      ),
      '<staffDef n="1" lines="5"><keySig sig="0"/></staffDef>'
    )

    const onsets = new Map([
      ['early', 0],
      ['sharpened', 3],
      ['held', 0],
      ['later', 3.5],
    ])

    // Written order alone would sharpen `held`, which sounds two beats earlier
    expect(Object.fromEntries(impliedAlterations(parse(mei), onsets))).toEqual({ later: 1 })
    expect(Object.fromEntries(impliedAlterations(parse(mei)))).toEqual({ held: 1, later: 1 })
  })

  it('carries across the layers of its staff but not to another staff', () => {
    const mei = score(
      '',
      measure(
        `<staff n="1"><layer n="1">${note('marked', 'b', 4, 'accid="n"')}</layer>` +
          `<layer n="2">${note('other-layer', 'b', 4)}</layer></staff>` +
          staff(note('other-staff', 'b', 4), 2)
      ),
      `<staffDef n="1" lines="5"><keySig sig="5f"/></staffDef><staffDef n="2" lines="5"><keySig sig="5f"/></staffDef>`
    )

    expect(alterations(mei)).toEqual({ 'other-staff': -1 })
  })
})

describe('the key signature in force', () => {
  it('is the one the staff states, over the one the score does', () => {
    const mei = score(
      '',
      measure(staff(note('one', 'b', 4), 1) + staff(note('two', 'b', 3), 2)),
      `<staffDef n="1" lines="5"><keySig sig="5f"/></staffDef><staffDef n="2" lines="5"><keySig sig="2s"/></staffDef>`
    )

    // Staff 2 is in D major, which does not touch b at all
    expect(alterations(mei)).toEqual({ one: -1 })
  })

  it('changes where a later scoreDef changes it', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('before', 'b', 4))) +
        '<scoreDef><staffGrp><staffDef n="1"><keySig sig="2s"/></staffDef></staffGrp></scoreDef>' +
        measure(staff(note('after', 'b', 4) + note('sharpened', 'f', 4)), 2)
    )

    expect(alterations(mei)).toEqual({ before: -1, sharpened: 1 })
  })

  it('is left alone by a scoreDef that changes only a clef', () => {
    // What the op. 9 sources do at m. 83, where the left hand takes a treble clef
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('before', 'b', 4))) +
        '<scoreDef><staffGrp><staffDef n="1"><clef shape="G" line="2"/></staffDef></staffGrp></scoreDef>' +
        measure(staff(note('after', 'b', 4)), 2)
    )

    expect(alterations(mei)).toEqual({ before: -1, after: -1 })
  })

  it('changes where the music itself writes a new one', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(staff(note('before', 'b', 4))) +
        measure(staff('<keySig sig="0"/>' + note('after', 'b', 4)), 2)
    )

    expect(alterations(mei)).toEqual({ before: -1 })
  })

  it('can be written out pitch by pitch', () => {
    const mei = score(
      '<keySig sig="1f"><keyAccid pname="b" accid="f"/><keyAccid pname="f" accid="s"/></keySig>',
      measure(staff(note('flattened', 'b', 4) + note('sharpened', 'f', 4)))
    )

    // The written accidentals are the signature; @sig is not read beside them
    expect(alterations(mei)).toEqual({ flattened: -1, sharpened: 1 })
  })

  it('is read from @key.sig where a document uses the attribute', () => {
    const mei = score(
      '',
      measure(staff(note('b', 'b', 4))),
      '<staffDef n="1" lines="5" key.sig="5f"><clef shape="G" line="2"/></staffDef>'
    )

    expect(alterations(mei)).toEqual({ b: -1 })
  })
})

describe('a passage with more than one reading', () => {
  it('is read the way verovio plays it, and the other reading changes nothing', () => {
    const mei = score(
      '<keySig sig="5f"/>',
      measure(
        staff(
          '<app>' +
            `<rdg source="original">${note('original', 'b', 4, 'accid="n"')}</rdg>` +
            `<rdg source="performance">${note('played', 'b', 4)}</rdg>` +
            '</app>' +
            note('after', 'b', 4)
        )
      )
    )

    // The natural is in the reading nobody plays, so it neither sounds nor carries
    expect(alterations(mei)).toEqual({ played: -1, after: -1 })
  })
})

/**
 * Humdrum states pitch outright - `bb-` is B flat 5 whatever the key signature
 * says - and verovio's converter numbers every note it makes `note-L{line}F{field}`
 * after the token it came from. So the kern the fixture was cut from can be read
 * back token by token and joined to the MEI note for note.
 */
const PITCH_CLASS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

interface KernNote {
  pname: string
  oct: number
  pitch: number
}

/** Every note of a Humdrum file, by the id verovio's converter gives it */
function readKern(kern: string): Map<string, KernNote> {
  const notes = new Map<string, KernNote>()

  kern.split('\n').forEach((line, index) => {
    if (line.startsWith('!') || line.startsWith('*') || line.startsWith('=')) return

    line.split('\t').forEach((field, fieldIndex) => {
      // A chord is one token of subtokens, and its notes are numbered within it
      const subtokens = field.trim().split(' ')

      subtokens.forEach((token, subIndex) => {
        const letters = /([a-g]+|[A-G]+)/.exec(token)
        if (!letters || token.includes('r')) return

        const run = letters[1]
        const pname = run[0].toLowerCase()
        // `c` is middle C and every further letter is another octave up; `C` is
        // the octave below it and every further letter another octave down
        const oct = run[0] === pname ? 3 + run.length : 4 - run.length
        const alteration = (token.match(/#/g) ?? []).length - (token.match(/-/g) ?? []).length

        const id =
          `note-L${index + 1}F${fieldIndex + 1}` + (subtokens.length > 1 ? `S${subIndex + 1}` : '')
        notes.set(id, {
          pname,
          oct,
          pitch: PITCH_CLASS[pname] + alteration + (oct + 1) * 12,
        })
      })
    })
  })

  return notes
}

describe('a score that leaves its accidentals to the key signature', () => {
  // Chopin, Nocturne op. 9 no. 1, in B flat minor: five flats in the signature and
  // not one @accid.ges in the file. See test/fixtures/README.md.
  const mei = load('fixtures/chopin-op9-mm1-6.mei')
  const kern = readKern(load('fixtures/chopin-op9-mm1-6.krn'))

  let notes: ScoreNote[]
  beforeAll(async () => {
    notes = await getNotesFromMEI(mei, { collapseUnisons: false })
  })

  it('is the case this exists for', () => {
    const doc = parse(mei)
    expect(doc.querySelector('keySig')?.getAttribute('sig')).toBe('5f')
    expect(doc.querySelectorAll('[accid\\.ges]')).toHaveLength(0)
    // Half the notes of the excerpt take their accidental from the signature and
    // from nowhere else, which is the whole of what verovio does not read
    expect(impliedAlterations(doc).size).toBe(70)
    expect(doc.querySelectorAll('note')).toHaveLength(141)
  })

  it('reads every note at the pitch the Humdrum source states', () => {
    expect(notes.length).toBeGreaterThan(100)

    const wrong = notes.filter((note) => {
      const truth = kern.get(note.note)
      return truth !== undefined && truth.pitch !== note.pitch
    })

    expect(wrong.map((note) => `${note.note} is ${note.pitch}, kern says ${kern.get(note.note)!.pitch}`)).toEqual([])
    // and the join really did reach the notes, rather than missing all of them
    expect(notes.filter((note) => kern.has(note.note))).toHaveLength(notes.length)
  })

  it('spells the notes the way the Humdrum does, so the join is on the right tokens', () => {
    const doc = parse(mei)
    const mismatched = [...doc.querySelectorAll('note')].filter((element) => {
      const truth = kern.get(element.getAttribute('xml:id') ?? '')
      if (!truth) return false
      return (
        element.getAttribute('pname') !== truth.pname ||
        Number(element.getAttribute('oct')) !== truth.oct
      )
    })

    expect(mismatched).toHaveLength(0)
  })

  it('is in B flat minor once it is read, not in C major', () => {
    const histogram = new Array(12).fill(0)
    for (const note of notes) histogram[((note.pitch % 12) + 12) % 12]++

    // B flat, D flat, E flat, G flat and A flat against their naturals
    const flats = [10, 1, 3, 6, 8].reduce((sum, pc) => sum + histogram[pc], 0)
    const naturals = [11, 2, 4, 7, 9].reduce((sum, pc) => sum + histogram[pc], 0)

    expect(flats).toBeGreaterThan(naturals * 4)
  })
})

/**
 * The other side of the same coin: a document that spells every alteration out has
 * nothing implied left over, so nothing here may move. MusicXML states pitch
 * absolutely - `<step>B</step>` with no `<alter>` is B natural, whatever the key
 * signature - which makes the source of each fixture the authority on what it
 * should sound.
 */
const MUSICXML_STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function readMusicXml(xml: string): Map<string, number> {
  const doc = parse(xml)
  const pitches = new Map<string, number>()

  for (const note of doc.querySelectorAll('note')) {
    const id = note.getAttribute('id')
    const step = note.querySelector('pitch > step')?.textContent
    const octave = note.querySelector('pitch > octave')?.textContent
    if (!id || !step || !octave) continue

    const alter = Number(note.querySelector('pitch > alter')?.textContent ?? 0)
    pitches.set(id, MUSICXML_STEP[step] + alter + (Number(octave) + 1) * 12)
  }

  return pitches
}

describe('a score that spells every alteration out', () => {
  for (const name of ['chopin-op38-mm18-22', 'chopin-op38-mm40-46', 'mozart-kv279-mm30-35']) {
    describe(name, () => {
      const mei = load(`fixtures/${name}.mei`)

      it('has nothing left for the key signature to imply', () => {
        expect(impliedAlterations(parse(mei)).size).toBe(0)
      })

      it('sounds at the pitches its MusicXML states', async () => {
        const truth = readMusicXml(load(`fixtures/${name}.musicxml`))
        const notes = await getNotesFromMEI(mei, { collapseUnisons: false })

        const wrong = notes.filter((note) => {
          const want = truth.get(note.note)
          return want !== undefined && want !== note.pitch
        })

        expect(wrong.map((note) => `${note.note} is ${note.pitch}, MusicXML says ${truth.get(note.note)}`)).toEqual([])
        expect(notes.filter((note) => truth.has(note.note)).length).toBeGreaterThan(80)
      })
    })
  }
})
