// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  addOrnamentSign,
  addPlayedNotes,
  markUnplayed,
  replaceWithPlayed,
} from '../../src/mei/editScore'
import type { NoteSpan } from '../../src/performance/midiSpans'

const score = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <music><body><mdiv><score>
    <section><measure xml:id="m1" n="1"><staff n="1"><layer n="1">
      <note xml:id="n1" pname="c" oct="4" dur="4"/>
      <note xml:id="n2" pname="d" oct="4" dur="4"/>
      <note xml:id="n3" pname="e" oct="4" dur="4"/>
    </layer></staff></measure></section>
  </score></mdiv></body></music>
</mei>`

const parse = () => new DOMParser().parseFromString(score, 'application/xml')
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc)

const span = (id: string, pitch: number): NoteSpan => ({
  type: 'note',
  id,
  onset: 0,
  offset: 100,
  onsetMs: 0,
  offsetMs: 100,
  pitch,
  velocity: 64,
  channel: 0,
})

describe('adding notes the performer played', () => {
  it('keeps the score’s own reading beside the performance’s', () => {
    const doc = parse()
    expect(addPlayedNotes(doc, 'n1', [span('x1', 48)], 'added-octave', 'C')).toBe(true)

    const app = doc.querySelector('app')
    expect(app).not.toBeNull()
    expect(app!.querySelector('rdg[source="original"] note')?.getAttribute('xml:id')).toBe('n1')

    const performance = app!.querySelector('rdg[source="performance"]')
    expect(performance!.getAttribute('reason')).toBe('added-octave')

    // The written note is played too, so the reading holds it as well as the addition
    const ids = [...performance!.querySelectorAll('note')].map((n) => n.getAttribute('xml:id'))
    expect(ids).toEqual(['n1', 'x1'])
  })

  it('gives the new note the played note’s own id, so the next alignment matches it', () => {
    const doc = parse()
    addPlayedNotes(doc, 'n1', [span('perf-42', 48)], 'added-octave', 'C')

    expect(doc.querySelector('[*|id="perf-42"]')).not.toBeNull()
  })

  it('spells the new note in the key rather than always with a sharp', () => {
    const flat = parse()
    addPlayedNotes(flat, 'n1', [span('x1', 61)], 'fuller-chord', 'Db')
    const inFlats = flat.querySelector('[*|id="x1"]')
    expect(inFlats?.getAttribute('pname')).toBe('d')
    expect(inFlats?.getAttribute('accid')).toBe('f')

    const sharp = parse()
    addPlayedNotes(sharp, 'n1', [span('x1', 61)], 'fuller-chord', 'D')
    const inSharps = sharp.querySelector('[*|id="x1"]')
    expect(inSharps?.getAttribute('pname')).toBe('c')
    expect(inSharps?.getAttribute('accid')).toBe('s')
  })

  it('leaves the document well formed', () => {
    const doc = parse()
    addPlayedNotes(doc, 'n2', [span('x1', 50)], 'ornamentation', 'C')

    const reparsed = new DOMParser().parseFromString(serialize(doc), 'application/xml')
    expect(reparsed.querySelector('parsererror')).toBeNull()
  })

  it('does nothing where the anchor is not in the document', () => {
    const doc = parse()
    expect(addPlayedNotes(doc, 'no-such-note', [span('x1', 50)], 'ornamentation', 'C')).toBe(false)
    expect(doc.querySelector('app')).toBeNull()
  })
})

describe('marking notes the performer did not play', () => {
  it('keeps them in the score, as the original reading', () => {
    const doc = parse()
    expect(markUnplayed(doc, ['n2', 'n3'], { resp: 'NP', certainty: 'medium' })).toBe(true)

    const original = doc.querySelector('rdg[source="original"]')
    const ids = [...original!.querySelectorAll('note')].map((n) => n.getAttribute('xml:id'))
    expect(ids).toEqual(['n2', 'n3'])

    // and the performance simply does not have them
    const performance = doc.querySelector('rdg[source="performance"]')
    expect(performance!.querySelectorAll('note')).toHaveLength(0)
    expect(performance!.getAttribute('reason')).toBe('simplification')
  })

  it('records who decided and how sure they were', () => {
    const doc = parse()
    markUnplayed(doc, ['n2'], { resp: 'NP', certainty: 'low', note: 'inner voice, inaudible' })

    const supplied = doc.querySelector('rdg[source="performance"] supplied')
    expect(supplied!.getAttribute('resp')).toBe('NP')
    expect(supplied!.getAttribute('certainty')).toBe('low')
    expect(supplied!.querySelector('annot')?.textContent).toBe('inner voice, inaudible')
  })

  it('never removes a note from the document', () => {
    const doc = parse()
    markUnplayed(doc, ['n1', 'n2', 'n3'])

    for (const id of ['n1', 'n2', 'n3']) {
      expect(doc.querySelector(`[*|id="${id}"]`)).not.toBeNull()
    }
  })
})

describe('putting an ornament sign on a note that had none', () => {
  it('adds the sign pointing at the note', () => {
    const doc = parse()
    expect(addOrnamentSign(doc, 'n2', 'trill', { resp: 'NP', certainty: 'medium' })).toBe(true)

    const trill = doc.querySelector('trill')
    expect(trill!.getAttribute('startid')).toBe('#n2')
    expect(trill!.getAttribute('resp')).toBe('NP')
    expect(trill!.closest('measure')?.getAttribute('xml:id')).toBe('m1')
  })

  it('adds no notes to the score, because a sign is not its realisation', () => {
    const doc = parse()
    const before = doc.querySelectorAll('note').length
    addOrnamentSign(doc, 'n2', 'mordent')

    expect(doc.querySelectorAll('note')).toHaveLength(before)
  })
})

describe('a written note played as a different note', () => {
  it('puts the played note beside the written one, and chooses neither', () => {
    const doc = parse()
    expect(replaceWithPlayed(doc, 'n2', span('x1', 61), 'C')).toBe(true)

    const app = doc.querySelector('app')
    expect(app).not.toBeNull()

    const written = app!.querySelector('rdg[source="original"] note')
    expect(written!.getAttribute('xml:id')).toBe('n2')
    expect(written!.getAttribute('pname')).toBe('d')

    const performance = app!.querySelector('rdg[source="performance"]')
    expect(performance!.getAttribute('reason')).toBe('substitution')

    // Unlike an addition, the reading holds the substitute alone: the written
    // note is what it stood in for, not something that sounded beside it
    const played = [...performance!.querySelectorAll('note')]
    expect(played).toHaveLength(1)
    expect(played[0].getAttribute('pname')).toBe('c')
    expect(played[0].getAttribute('accid')).toBe('s')
    expect(played[0].getAttribute('xml:id')).toBe('x1')
  })

  it('gives the substitute the rhythm of the note it stands in for', () => {
    const doc = parse()
    replaceWithPlayed(doc, 'n2', span('x1', 61), 'C')

    const played = doc.querySelector('rdg[source="performance"] note')
    expect(played!.getAttribute('dur')).toBe('4')
  })

  it('leaves the document alone where the note is not in it', () => {
    const doc = parse()
    expect(replaceWithPlayed(doc, 'no-such-note', span('x1', 61), 'C')).toBe(false)
    expect(doc.querySelector('app')).toBeNull()
    expect(serialize(doc)).toContain('<note xml:id="n2" pname="d" oct="4" dur="4"/>')
  })
})
