import { describe, expect, it } from 'vitest'
import { transcribe, untranscribed, writtenIdOf, type Notation, type NoteEdit } from '../../../src/alignment/transcription'
import { readScore } from '../../../src/alignment/transcription/scoreModel'
import { getNotesFromMEI } from '../../../src/score/scoreNotes'
import { PLAYED, SOURCE, added, aligned, canonical, missing, parse, replaced, scoreMei, span } from './fixture'

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

  it('is written at the nearest end of the score where it was played outside it', () => {
    // Before the first note and after the last: there is no tempo out there, and a note that
    // was played is in the score all the same
    const early = span('x1', -4000, 60)
    const late = span('x2', 9000, 36)
    const result = transcribe({
      mei: aligned(scoreMei(), { extra: [early, late] }),
      source: SOURCE,
      divergences: [added('a', [early], 'outside'), added('b', [late], 'outside')],
      spans: [early, late],
    })
    const after = standing(result.mei)

    expect(result.outcomes.get('a')?.written).toBe('measured')
    expect(after.get(writtenIdOf(early))?.onset).toBe(0)
    expect(after.get(writtenIdOf(late))?.onset).toBeGreaterThanOrEqual(6)
    expect(after.get(writtenIdOf(late))?.onset).toBeLessThan(8)
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

  it('does not leave a played note out of the score, whatever an older file asked for', () => {
    // `none` is what a decision to "record only" reads as. It is no longer a way of writing
    // a note that was played, so it is read as no decision at all
    expect(canonical(ask('none').mei)).toBe(canonical(ask('auto').mei))
    expect(ask('none').outcomes.get('a')?.written).not.toBe('none')
  })

  it('offers the ways a played note can be written, and leaving it out is not one', () => {
    expect(ask('auto').outcomes.get('a')?.offers).toEqual(['auto', 'measured', 'grace', 'sign'])
  })
})

describe('a note a reader has moved by hand', () => {
  const passing = span('x1', 750, 73, 250)
  const base = aligned(scoreMei(), { extra: [passing] })
  const id = writtenIdOf(passing)
  const withEdit = (edit: NoteEdit) =>
    transcribe({
      mei: base,
      source: SOURCE,
      divergences: [added('a', [passing])],
      spans: [passing],
      edits: new Map([[id, edit]]),
    })
  const untouched = transcribe({ mei: base, source: SOURCE, divergences: [added('a', [passing])], spans: [passing] })
  const info = untouched.outcomes.get('a')!.notes[0]

  it('says of every written note where it could go, how long it could be and on which staff', () => {
    expect(info).toMatchObject({ id, onset: 1.5, measure: 0, staff: '1', staves: ['1', '2'], grace: false, units: 12 })
    // From the written note before it to the one after, and the grid between, in order
    expect(info.places[0]).toBe(1)
    expect(info.places[info.places.length - 1]).toBe(2)
    expect(info.places).toContain(1.5)
    expect(info.places).toEqual([...info.places].sort((a, b) => a - b))
    expect(info.values).toContain(12)
    expect(info.values).toEqual([...info.values!].sort((a, b) => b - a))
  })

  it('is written where it was put, whatever the timing says', () => {
    const result = withEdit({ onset: 1.25 })
    expect(standing(result.mei).get(id)?.onset).toBe(1.25)
    // And the bar is as long as it was
    expect(standing(result.mei).get('n5')?.onset).toBe(4)
    expect(result.outcomes.get('a')?.notes[0].onset).toBe(1.25)
  })

  it('joins the written note it was moved onto', () => {
    const result = withEdit({ onset: 2 })
    expect(performance(parse(result.mei), id)?.closest('chord')?.getAttribute('xml:id')).toBe('ch')
  })

  it('is as long as it was made', () => {
    const result = withEdit({ units: 6 })
    expect(performance(parse(result.mei), id)?.getAttribute('dur')).toBe('16')
    expect(result.outcomes.get('a')?.notes[0].units).toBe(6)
  })

  it('goes on the staff it was given', () => {
    const result = withEdit({ staff: '2' })
    expect(performance(parse(result.mei), id)?.closest('staff')?.getAttribute('n')).toBe('2')
  })

  it('keeps to the transcriber where it was asked for something that cannot be', () => {
    // A place outside the two notes it was played between, a length no note value has
    for (const edit of [{ onset: 3.5 }, { units: 5 }, { staff: '7' }]) {
      expect(canonical(withEdit(edit).mei), JSON.stringify(edit)).toBe(canonical(untouched.mei))
    }
  })

  it('comes out again with everything else', () => {
    expect(canonical(untranscribed(withEdit({ onset: 1.25, units: 6, staff: '2' }).mei))).toBe(canonical(base))
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

describe('a tie', () => {
  // The second c5 tied to the first: one note of two quarters, as the score has it
  const tied = scoreMei().replace(
    '<note xml:id="n2" pname="d" oct="5" dur="4"/>',
    '<note xml:id="n2" pname="c" oct="5" dur="4"/>',
  ).replace('</measure>', '<tie xml:id="t1" startid="#n1" endid="#n2"/></measure>')
  // The aligner sees one note there, so the second key going down has no written note
  const { n2: _tiedInto, ...struckOnce } = PLAYED
  void _tiedInto
  const again = span('x1', 510, 72)

  const result = transcribe({
    mei: aligned(tied, { played: struckOnce, extra: [again] }),
    source: SOURCE,
    divergences: [added('a', [again])],
    spans: [again],
  })
  const doc = parse(result.mei)

  it('that was not held is taken out, and no note is written: the note is there already', () => {
    expect(result.outcomes.get('a')?.written).toBe('measured')
    expect(result.outcomes.get('a')?.because).toMatch(/struck again/)
    expect(doc.querySelector('app[type="transcription"] > rdg[source="original"] > tie[*|id="t1"]')).not.toBeNull()
    expect(doc.querySelector('app[type="transcription"] > rdg[source="performance"]')?.children).toHaveLength(0)
    expect(doc.querySelector(`[*|id="${writtenIdOf(again)}"]`)).toBeNull()
    expect(doc.querySelectorAll('note')).toHaveLength(parse(tied).querySelectorAll('note').length)
  })

  it('names the reading by the line it takes away, the same every time', () => {
    expect(result.readings).toEqual(['reading-t1'])
    expect(doc.querySelector('app[type="transcription"]')?.getAttribute('xml:id')).toBe('reading-t1')
    const second = transcribe({
      mei: result.mei,
      source: SOURCE,
      divergences: [added('a', [again])],
      spans: [again],
    })
    expect(second.readings).toEqual(result.readings)
  })

  it('leaves the recording pointing at the note the tie ran into', () => {
    const when = doc.querySelector('when[data="#n2"]')
    expect(when?.getAttribute('absolute')).toBe('510ms')
    expect(when?.getAttribute('type')).toBeNull()
    expect(result.outcomes.get('a')?.noteIds).toEqual(['n2'])
    expect(result.outcomes.get('a')?.notes[0]).toMatchObject({ id: 'n2', played: writtenIdOf(again) })
  })

  it('makes two sounding notes of what was one, for verovio as for the chain', async () => {
    const before = await getNotesFromMEI(aligned(tied, { played: struckOnce }), { collapseUnisons: false })
    const after = await getNotesFromMEI(result.mei, { collapseUnisons: false })

    expect(before.find((note) => note.note === 'n2')).toBeUndefined()
    expect(before.find((note) => note.note === 'n1')?.duration).toBe(2)
    expect(after.find((note) => note.note === 'n2')).toMatchObject({ onset: 1, pitch: 72, duration: 1 })
    expect(after.find((note) => note.note === 'n1')?.duration).toBe(1)
  })

  it('comes back with the reading', () => {
    expect(canonical(untranscribed(result.mei))).toBe(canonical(aligned(tied, { played: struckOnce, extra: [again] })))
  })

  it('is written where a note was held on instead of struck again', () => {
    // Two c5 in a row, and the first key still down when the second was due
    const repeated = scoreMei().replace(
      '<note xml:id="n2" pname="d" oct="5" dur="4"/>',
      '<note xml:id="n2" pname="c" oct="5" dur="4"/>',
    )
    const heldDoc = parse(aligned(repeated, { unplayed: ['n2'] }))
    // n1 held for 900 ms: through the half second at which n2 was due
    heldDoc.querySelector('when[data="#n1"] extData[type="duration"]')!.textContent = '900ms'
    const out = transcribe({
      mei: new XMLSerializer().serializeToString(heldDoc),
      source: SOURCE,
      divergences: [missing('m', ['n2'])],
      spans: [],
    })
    const written = parse(out.mei)

    expect(out.outcomes.get('m')?.because).toMatch(/tied/)
    expect(written.querySelector('rdg[source="performance"] > tie[startid="#n1"][endid="#n2"]')).not.toBeNull()
    // The note stands: it sounds, as the end of the one before it
    expect(written.querySelector('rdg[source="original"] > note[*|id="n2"]')).toBeNull()
    expect(written.querySelector('rest')).toBeNull()
  })

  it('is not written where the note before was let go: that is a note left out', () => {
    const repeated = scoreMei().replace(
      '<note xml:id="n2" pname="d" oct="5" dur="4"/>',
      '<note xml:id="n2" pname="c" oct="5" dur="4"/>',
    )
    const heldDoc = parse(aligned(repeated, { unplayed: ['n2'] }))
    heldDoc.querySelector('when[data="#n1"] extData[type="duration"]')!.textContent = '200ms'
    const out = transcribe({
      mei: new XMLSerializer().serializeToString(heldDoc),
      source: SOURCE,
      divergences: [missing('m', ['n2'])],
      spans: [],
    })

    expect(parse(out.mei).querySelector('rdg[source="performance"] > rest')).not.toBeNull()
    expect(parse(out.mei).querySelector('rdg[source="performance"] > tie')).toBeNull()
  })
})

describe('a written note the aligner did not pair with the key that played it', () => {
  it('is that note: nothing is written and nothing taken out', () => {
    const same = span('x1', 2510, 76)
    const base = aligned(scoreMei(), { unplayed: ['n6'], extra: [same] })
    const result = transcribe({
      mei: base,
      source: SOURCE,
      divergences: [missing('m', ['n6']), added('a', [same])],
      spans: [same],
    })
    const doc = parse(result.mei)

    expect(doc.querySelector('app')).toBeNull()
    expect(doc.querySelector('when[data="#n6"][absolute="2510ms"]')).not.toBeNull()
    expect(result.outcomes.get('m')?.written).toBe('none')
    // No difference, so nothing to colour: the played note is known by the note it is
    expect(result.outcomes.get('a')?.written).toBe('as-written')
    expect(result.outcomes.get('a')?.noteIds).toEqual([])
    expect(result.outcomes.get('a')?.notes.map((note) => note.id)).toEqual(['n6'])
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
      choices: new Map<string, Notation>([['a2', 'grace'], ['m1', 'none']]),
    })
    const doc = parse(changed.mei)

    expect(doc.querySelector(`[*|id="${writtenIdOf(extras[2])}"]`)?.getAttribute('grace')).toBe('unacc')
    expect(doc.querySelector('rdg[source="original"] > note[*|id="n6"]')).toBeNull()
    expect(doc.querySelector('note[*|id="n6"]')).not.toBeNull()
    // And what was not changed is still there
    expect(doc.querySelector(`[*|id="${writtenIdOf(extras[0])}"]`)).not.toBeNull()
  })
})
