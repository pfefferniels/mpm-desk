import { describe, expect, it } from 'vitest'
import { transcribe, untranscribed, writtenIdOf, type Notation } from '../../../src/alignment/transcription'
import { readScore } from '../../../src/alignment/transcription/scoreModel'
import { getNotesFromMEI } from '../../../src/score/scoreNotes'
import { SOURCE, added, aligned, canonical, missing, parse, replaced, scoreMei, span } from './fixture'

/** Where every written note of a document stands and what it sounds as, by id. */
const standing = (mei: string) => {
  const model = readScore(parse(mei))
  return new Map([...model.notes].map(([id, note]) => [id, { onset: note.event.onset, pitch: note.pitch }]))
}

const performance = (doc: Document, id: string) =>
  doc.querySelector(`rdg[source="performance"] [*|id="${id}"]`)

describe('a played note the score does not write', () => {
  it('joins the written note it was struck with, as a chord, and takes its length', () => {
    const octave = span('x1', 5, 36)
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: [octave] }),
      source: SOURCE,
      divergences: [added('a', [octave], 'added-octave')],
      spans: [octave],
    })
    const doc = parse(result.mei)
    const written = performance(doc, writtenIdOf(octave))

    expect(result.outcomes.get('a')?.written).toBe('measured')
    expect(written?.getAttribute('pname')).toBe('c')
    expect(written?.getAttribute('oct')).toBe('2')

    // One stem: the bass note and its octave are a chord of the bass note's length
    const chord = written?.parentElement
    expect(chord?.localName).toBe('chord')
    expect(chord?.getAttribute('dur')).toBe('2')
    expect(chord?.querySelector('[*|id="b1"]')).not.toBeNull()

    // And the source still has the single note
    expect(doc.querySelector('rdg[source="original"] > note[*|id="b1"]')).not.toBeNull()
  })

  it('goes inside a written chord without the chord being said twice', () => {
    const third = span('x1', 1004, 72)
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: [third] }),
      source: SOURCE,
      divergences: [added('a', [third], 'fuller-chord')],
      spans: [third],
    })
    const doc = parse(result.mei)

    const chord = doc.querySelector('chord[*|id="ch"]')
    expect(chord?.querySelector(`app rdg[source="performance"] note[*|id="${writtenIdOf(third)}"]`)).not.toBeNull()
    expect(doc.querySelectorAll('[*|id="n3"]')).toHaveLength(1)
    expect(doc.querySelectorAll('[*|id="ch"]')).toHaveLength(1)
  })

  it('is given a place of its own between two written notes, in a new voice', () => {
    // Halfway between the second quarter and the third, held to the third
    const passing = span('x1', 750, 73, 250)
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: [passing] }),
      source: SOURCE,
      divergences: [added('a', [passing])],
      spans: [passing],
    })
    const doc = parse(result.mei)
    const written = performance(doc, writtenIdOf(passing))

    expect(written?.getAttribute('dur')).toBe('8')
    expect(written?.getAttribute('pname')).toBe('c')
    expect(written?.getAttribute('accid')).toBe('s')
    expect(written?.closest('layer')?.getAttribute('n')).toBe('2')
    expect(written?.closest('staff')?.getAttribute('n')).toBe('1')
    expect(written?.closest('app')?.parentElement?.localName).toBe('staff')

    expect(standing(result.mei).get(writtenIdOf(passing))).toEqual({ onset: 1.5, pitch: 73 })
  })

  it('puts added notes in one voice all through the piece, whatever each bar has', () => {
    // A second voice in the second bar only: the added voice has to be the third in both
    const twoVoices = scoreMei().replace(
      '<note xml:id="n7" pname="d" oct="5" dur="2"/></layer>',
      '<note xml:id="n7" pname="d" oct="5" dur="2"/></layer><layer n="2"><space dur="1"/></layer>',
    )
    const extras = [span('x1', 750, 73), span('x2', 2250, 81)]
    const result = transcribe({
      mei: aligned(twoVoices, { extra: extras }),
      source: SOURCE,
      divergences: extras.map((extra, index) => added(`a${index}`, [extra])),
      spans: extras,
    })
    const doc = parse(result.mei)

    for (const extra of extras) {
      expect(performance(doc, writtenIdOf(extra))?.closest('layer')?.getAttribute('n')).toBe('3')
    }
  })

  it('leaves every written note exactly where it stood', () => {
    const extras = [span('x1', 5, 36), span('x2', 750, 73), span('x3', 2250, 81), span('x4', 2760, 62)]
    const base = aligned(scoreMei(), { extra: extras })
    const result = transcribe({
      mei: base,
      source: SOURCE,
      divergences: extras.map((extra, index) => added(`a${index}`, [extra])),
      spans: extras,
    })

    const before = standing(base)
    const after = standing(result.mei)
    for (const [id, was] of before) expect(after.get(id), id).toEqual(was)
    expect(after.size).toBe(before.size + extras.length)
  })

  it('is read back by verovio at the place and pitch it was written at', async () => {
    const extras = [span('x1', 5, 36), span('x2', 750, 73)]
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: extras }),
      source: SOURCE,
      divergences: extras.map((extra, index) => added(`a${index}`, [extra])),
      spans: extras,
    })

    const notes = await getNotesFromMEI(result.mei, { collapseUnisons: false, notatedOnsets: true })
    const byId = new Map(notes.map((entry) => [entry.note, entry]))

    expect(byId.get(writtenIdOf(extras[0]))).toMatchObject({ onset: 0, pitch: 36, duration: 2 })
    expect(byId.get(writtenIdOf(extras[1]))).toMatchObject({ onset: 1.5, pitch: 73, duration: 0.5 })
    // The bars are as long as they were: the second still starts on the fifth quarter
    expect(byId.get('n5')?.onset).toBe(4)
    expect(byId.get('n3')?.onset).toBe(2)
  })

  it('writes a triplet inside a bracket that closes over the quarter', () => {
    // A third of the way from the second quarter to the third
    const triplet = span('x1', 667, 77, 160)
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: [triplet] }),
      source: SOURCE,
      divergences: [added('a', [triplet])],
      spans: [triplet],
      // Nothing in two bars of quarters says triplet, so the grid is told to trust the clock
      settings: { noiseMs: 4, rubato: 0.01 },
    })
    const doc = parse(result.mei)
    const written = performance(doc, writtenIdOf(triplet))
    const bracket = written?.closest('tuplet')

    expect(bracket?.getAttribute('num')).toBe('3')
    expect(bracket?.getAttribute('numbase')).toBe('2')
    expect(standing(result.mei).get(writtenIdOf(triplet))?.onset).toBeCloseTo(1 + 1 / 3, 6)
    // The bar is still four quarters long
    expect(standing(result.mei).get('n5')?.onset).toBe(4)
  })

  it('points the recording at the note written for it', () => {
    const octave = span('x1', 5, 36)
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: [octave] }),
      source: SOURCE,
      divergences: [added('a', [octave], 'added-octave')],
      spans: [octave],
    })
    const when = parse(result.mei).querySelector(`when[data="#${writtenIdOf(octave)}"]`)

    expect(when).not.toBeNull()
    expect(when?.getAttribute('type')).toBeNull()
    expect(when?.getAttribute('absolute')).toBe('5ms')
  })

  it('stays out of the score where it is a written ornament being played', () => {
    const shake = [span('x1', 520, 76), span('x2', 560, 74), span('x3', 600, 76)]
    const base = aligned(scoreMei(), { extra: shake })
    const result = transcribe({
      mei: base,
      source: SOURCE,
      divergences: [added('a', shake, 'written-ornament', 'n2')],
      spans: shake,
    })

    expect(result.outcomes.get('a')?.written).toBe('none')
    expect(canonical(result.mei)).toBe(canonical(base))
  })

  it('stays out of the score where it was played before the music begins', () => {
    const stray = span('x1', -4000, 60)
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: [stray] }),
      source: SOURCE,
      divergences: [added('a', [stray])],
      spans: [stray],
    })

    expect(result.outcomes.get('a')?.written).toBe('none')
    expect(result.mei).not.toContain('type="transcription"')
  })
})

describe('what a reader may ask for instead', () => {
  const lean = span('x1', 2940, 76)
  const ask = (notation: Notation) =>
    transcribe({
      mei: aligned(scoreMei(), { extra: [lean] }),
      source: SOURCE,
      divergences: [added('a', [lean], 'ornamentation', 'n7')],
      spans: [lean],
      choices: new Map([['a', notation]]),
    })

  it('writes grace notes before the note they lean on', () => {
    const result = ask('grace')
    const doc = parse(result.mei)
    const grace = performance(doc, writtenIdOf(lean))

    expect(result.outcomes.get('a')?.written).toBe('grace')
    expect(grace?.getAttribute('grace')).toBe('unacc')
    // In the voice of the half note it leans on, and directly in front of it
    expect(grace?.closest('app')?.nextElementSibling?.getAttribute('xml:id')).toBe('n7')
    // A grace note takes no time: the half note is where it was
    expect(standing(result.mei).get('n7')?.onset).toBe(6)
  })

  it('writes measured notes when told to, whatever the timing says', () => {
    const result = ask('measured')
    expect(result.outcomes.get('a')?.written).toBe('measured')
    expect(performance(parse(result.mei), writtenIdOf(lean))?.hasAttribute('grace')).toBe(false)
  })

  it('writes an ornament sign and leaves the notes to the recording', () => {
    const result = ask('sign')
    const doc = parse(result.mei)

    expect(result.outcomes.get('a')?.written).toBe('sign')
    expect(doc.querySelector('measure app[type="transcription"] rdg[source="performance"] > mordent[startid="#n7"]')).not.toBeNull()
    expect(doc.querySelector(`[*|id="${writtenIdOf(lean)}"]`)).toBeNull()
    // Still a played note with no written one, which is what an ornament's notes are
    expect(doc.querySelectorAll('when[type="insertion"]')).toHaveLength(1)
  })

  it('writes nothing when told to leave it out', () => {
    const base = aligned(scoreMei(), { extra: [lean] })
    const result = ask('none')

    expect(result.outcomes.get('a')?.written).toBe('none')
    expect(canonical(result.mei)).toBe(canonical(base))
  })

  it('says what else it could be written as', () => {
    expect(ask('auto').outcomes.get('a')?.offers).toEqual(['auto', 'measured', 'grace', 'sign', 'none'])
  })
})

describe('a written note that was not played', () => {
  it('leaves a rest of its length where it stood alone', () => {
    const result = transcribe({
      mei: aligned(scoreMei(), { unplayed: ['n6'] }),
      source: SOURCE,
      divergences: [missing('m', ['n6'])],
      spans: [],
    })
    const doc = parse(result.mei)
    const app = doc.querySelector('rdg[source="original"] > note[*|id="n6"]')?.closest('app')

    expect(result.outcomes.get('m')?.written).toBe('omitted')
    expect(app?.querySelector('rdg[source="performance"] > rest')?.getAttribute('dur')).toBe('4')
    expect(standing(result.mei).get('n7')?.onset).toBe(6)
    expect(standing(result.mei).has('n6')).toBe(false)
  })

  it('is taken out of a chord whose other notes were played, and nothing else changes', () => {
    const result = transcribe({
      mei: aligned(scoreMei(), { unplayed: ['n4'] }),
      source: SOURCE,
      divergences: [missing('m', ['n4'], 'thinned-chord')],
      spans: [],
    })
    const doc = parse(result.mei)

    expect(doc.querySelector('chord[*|id="ch"] > app > rdg[source="original"] > note[*|id="n4"]')).not.toBeNull()
    expect(doc.querySelector('chord[*|id="ch"] > app > rdg[source="performance"]')?.children).toHaveLength(0)
    expect(standing(result.mei).has('n3')).toBe(true)
    expect(standing(result.mei).has('n4')).toBe(false)
  })

  it('is not an omission where it is a unison the other voice played', () => {
    // The same d5 in two voices: one key, and the aligner can only give it to one of them
    const twoVoices = scoreMei().replace(
      '</layer></staff>\n        <staff n="2"><layer n="1"><note xml:id="b1"',
      '</layer><layer n="2"><space dur="4"/><note xml:id="twin" pname="d" oct="5" dur="4"/><space dur="2"/></layer></staff>\n        <staff n="2"><layer n="1"><note xml:id="b1"',
    )
    expect(twoVoices).toContain('xml:id="twin"')

    // The d5 of the first voice is matched; its twin is reported unplayed
    const meiWithTwin = (() => {
      const document = parse(aligned(twoVoices))
      const when = document.createElementNS('http://www.music-encoding.org/ns/mei', 'when')
      when.setAttribute('data', '#twin')
      when.setAttribute('type', 'deletion')
      document.querySelector('recording')!.appendChild(when)
      return new XMLSerializer().serializeToString(document)
    })()

    const result = transcribe({
      mei: meiWithTwin,
      source: SOURCE,
      divergences: [missing('m', ['twin'], 'thinned-chord')],
      spans: [],
    })

    expect(result.outcomes.get('m')?.written).toBe('none')
    expect(result.outcomes.get('m')?.because).toMatch(/unison/i)
    expect(result.mei).not.toContain('type="transcription"')
  })

  it('stays in the score when the reader says so', () => {
    const base = aligned(scoreMei(), { unplayed: ['n6'] })
    const result = transcribe({
      mei: base,
      source: SOURCE,
      divergences: [missing('m', ['n6'])],
      spans: [],
      choices: new Map([['m', 'none']]),
    })
    expect(canonical(result.mei)).toBe(canonical(base))
  })
})

describe('a written note played at another pitch', () => {
  const sharp = span('x1', 2000, 78)

  it('is written at the pitch it was played at, with the written note beside it', () => {
    const result = transcribe({
      mei: aligned(scoreMei(), { substituted: { n5: sharp } }),
      source: SOURCE,
      divergences: [replaced('r', 'n5', sharp, 77)],
      spans: [sharp],
    })
    const doc = parse(result.mei)
    const played = performance(doc, writtenIdOf(sharp))

    expect(result.outcomes.get('r')?.written).toBe('variant')
    expect(played?.getAttribute('pname')).toBe('f')
    expect(played?.getAttribute('accid')).toBe('s')
    // The written note's length, since a different pitch is not a different rhythm
    expect(played?.getAttribute('dur')).toBe('4')
    expect(doc.querySelector('rdg[source="original"] > note[*|id="n5"]')).not.toBeNull()
    expect(doc.querySelector(`when[data="#${writtenIdOf(sharp)}"]`)).not.toBeNull()
  })

  it('counts a pair the aligner failed to make as the written note, and writes nothing', () => {
    const same = span('x1', 2000, 77)
    const result = transcribe({
      mei: aligned(scoreMei(), { substituted: { n5: same } }),
      source: SOURCE,
      divergences: [{ ...replaced('r', 'n5', same, 77), reading: 'unmatched-pair' }],
      spans: [same],
    })
    const doc = parse(result.mei)

    expect(result.outcomes.get('r')?.written).toBe('as-written')
    expect(doc.querySelector('app')).toBeNull()
    expect(doc.querySelector('when[data="#n5"]')?.getAttribute('type')).toBeNull()
  })

  it('takes a note struck in place of an unplayed one for a substitution, not a chord', () => {
    // The aligner reports them apart: e5 unplayed, e flat played at its moment
    const flat = span('x1', 2502, 75)
    const result = transcribe({
      mei: aligned(scoreMei(), { unplayed: ['n6'], extra: [flat] }),
      source: SOURCE,
      divergences: [missing('m', ['n6']), added('a', [flat])],
      spans: [flat],
    })
    const doc = parse(result.mei)
    const played = performance(doc, writtenIdOf(flat))

    expect(played?.localName).toBe('note')
    expect(played?.parentElement?.localName).toBe('rdg')
    expect(played?.getAttribute('dur')).toBe('4')
    expect(doc.querySelector('rdg[source="performance"] [*|id="n6"]')).toBeNull()
  })
})

describe('accidentals, which hold to the barline', () => {
  // f5 g5 f5 g5: a sharp written on an added f changes what the second written f means
  const bar = [
    '<note xml:id="n1" pname="f" oct="5" dur="4"/>',
    '<note xml:id="n2" pname="g" oct="5" dur="4"/>',
    '<note xml:id="n3" pname="f" oct="5" dur="4"/>',
    '<note xml:id="n4" pname="g" oct="5" dur="4"/>',
  ].join('')
  const played = {
    n1: { ms: 0, pitch: 77 },
    n2: { ms: 500, pitch: 79 },
    n3: { ms: 1000, pitch: 77 },
    n4: { ms: 1500, pitch: 79 },
    b1: { ms: 0, pitch: 48 },
    b2: { ms: 1000, pitch: 55 },
    n5: { ms: 2000, pitch: 77 },
    n6: { ms: 2500, pitch: 76 },
    n7: { ms: 3000, pitch: 74 },
    b3: { ms: 2000, pitch: 48 },
  }
  const sharp = span('x1', 503, 78)
  const base = aligned(scoreMei(bar), { extra: [sharp], played })
  const result = transcribe({
    mei: base,
    source: SOURCE,
    divergences: [added('a', [sharp], 'fuller-chord')],
    spans: [sharp],
  })

  it('restates the accidental of a written note that a new one would have changed', () => {
    const doc = parse(result.mei)
    expect(performance(doc, writtenIdOf(sharp))?.getAttribute('accid')).toBe('s')
    expect(doc.querySelector('[*|id="n3"]')?.getAttribute('accid')).toBe('n')
  })

  it('keeps every written note sounding as it did', () => {
    const after = standing(result.mei)
    expect(after.get('n3')?.pitch).toBe(77)
    expect(after.get('n1')?.pitch).toBe(77)
    expect(after.get(writtenIdOf(sharp))?.pitch).toBe(78)
  })

  it('takes the restated accidental off again with the reading', () => {
    expect(canonical(untranscribed(result.mei))).toBe(canonical(base))
  })

  it('spells an added note the way the bars around it spell that pitch', () => {
    // An e flat in the bass of a piece that has just written d sharp would be wrong
    const withSharp = scoreMei().replace('<note xml:id="n6" pname="e" oct="5" dur="4"/>', '<note xml:id="n6" pname="d" oct="5" dur="4" accid="s"/>')
    const low = span('x1', 2003, 51)
    const out = transcribe({
      mei: aligned(withSharp, { extra: [low], played: { ...played, n6: { ms: 2500, pitch: 75 } } }),
      source: SOURCE,
      divergences: [added('a', [low])],
      spans: [low],
    })
    const written = performance(parse(out.mei), writtenIdOf(low))

    expect(written?.getAttribute('pname')).toBe('d')
    expect(written?.getAttribute('accid')).toBe('s')
  })
})

describe('taking a transcription out again', () => {
  const extras = [span('x1', 5, 36), span('x2', 750, 73), span('x3', 2940, 76)]
  const sharp = span('x4', 2000, 78)
  const base = aligned(scoreMei(), { extra: extras, unplayed: ['n6', 'n4'], substituted: { n5: sharp } })
  const divergences = [
    ...extras.map((extra, index) => added(`a${index}`, [extra])),
    missing('m1', ['n6']),
    missing('m2', ['n4'], 'thinned-chord'),
    replaced('r', 'n5', sharp, 77),
  ]
  const spans = [...extras, sharp]
  const result = transcribe({ mei: base, source: SOURCE, divergences, spans })

  it('gives back the document that went in', () => {
    expect(result.mei).toContain('type="transcription"')
    expect(canonical(untranscribed(result.mei))).toBe(canonical(base))
  })

  it('hands an untouched document back as it is', () => {
    expect(untranscribed(base)).toBe(base)
  })

  it('transcribes a transcribed document to the same thing, not on top of it', () => {
    const again = transcribe({ mei: result.mei, source: SOURCE, divergences, spans })
    expect(canonical(again.mei)).toBe(canonical(result.mei))
  })

  it('writes a changed mind from the source, leaving nothing of the first answer', () => {
    const changed = transcribe({
      mei: result.mei,
      source: SOURCE,
      divergences,
      spans,
      choices: new Map<string, Notation>([['a1', 'none'], ['m1', 'none']]),
    })
    const doc = parse(changed.mei)

    expect(doc.querySelector(`[*|id="${writtenIdOf(extras[1])}"]`)).toBeNull()
    expect(doc.querySelector('rdg[source="original"] > note[*|id="n6"]')).toBeNull()
    expect(doc.querySelector('note[*|id="n6"]')).not.toBeNull()
    // And what was not changed is still there
    expect(doc.querySelector(`[*|id="${writtenIdOf(extras[0])}"]`)).not.toBeNull()
  })
})
