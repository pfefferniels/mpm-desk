import { describe, expect, it } from 'vitest'
import { convertMeiToMsm } from 'espressivo'
import { transcribe, untranscribed, writtenIdOf } from '../../../src/alignment/transcription'
import { asMSM } from '../../../src/fitting/asMSM'
import { performanceReading } from '../../../src/mei/performanceReading'
import { PLAYED, SOURCE, added, aligned, canonical, missing, parse, replaced, scoreMei, span } from './fixture'

/**
 * A performance reading says what the recording settles, and some of them say more: where in the
 * bar a note of its own falls and how long it is, which voice it is in, whether a figure is grace
 * notes or a sign. That much is the editor's, and stands in a `<supplied>` inside the reading.
 */

/** The `<supplied>` a note written for a played one stands in, if it stands in one. */
const suppliedAround = (doc: Document, id: string) => doc.querySelector(`[*|id="${id}"]`)?.closest('supplied')

describe('what the editor decided', () => {
  it('writes a note at a place of its own, in a voice that was playing, as supplied for rhythm and voicing', () => {
    // Halfway between the second quarter and the third, with the second quarter let go as it
    // is struck: the second quarter then ends where it begins
    const passing = span('x1', 750, 73, 250)
    const doc = parse(
      transcribe({
        mei: aligned(scoreMei(), { extra: [passing], heldMs: 240 }),
        source: SOURCE,
        divergences: [added('a', [passing])],
        spans: [passing],
      }).mei,
    )
    const supplied = suppliedAround(doc, writtenIdOf(passing))

    expect(supplied?.parentElement?.matches('app[type="transcription"] > rdg[source="performance"]')).toBe(true)
    expect(supplied?.getAttribute('reason')).toBe('rhythm voicing')
    expect(supplied?.getAttribute('evidence')).toBe('internal')
    expect(['high', 'medium', 'low']).toContain(supplied?.getAttribute('cert'))
    // The note it cut short is in it too: what becomes of it is the same decision
    expect(supplied?.querySelector('[*|id="n2"]')?.getAttribute('dur')).toBe('8')
  })

  it('writes a voice of its own as supplied, the layer and all', () => {
    // The same note, struck while the second quarter is still down: a second voice
    const passing = span('x1', 750, 73, 250)
    const doc = parse(
      transcribe({ mei: aligned(scoreMei(), { extra: [passing] }), source: SOURCE, divergences: [added('a', [passing])], spans: [passing] }).mei,
    )

    const supplied = doc.querySelector('staff > app > rdg[source="performance"] > supplied')
    expect(supplied?.getAttribute('reason')).toBe('rhythm voicing')
    expect(supplied?.children).toHaveLength(1)
    expect(supplied?.firstElementChild?.localName).toBe('layer')
    expect(supplied?.querySelector(`[*|id="${writtenIdOf(passing)}"]`)).not.toBeNull()
  })

  describe('a figure', () => {
    const lean = span('x1', 2940, 76)
    const asked = (notation: 'grace' | 'sign') =>
      parse(
        transcribe({
          mei: aligned(scoreMei(), { extra: [lean] }),
          source: SOURCE,
          divergences: [added('a', [lean], 'ornamentation', 'n7')],
          spans: [lean],
          choices: new Map([['a', notation]]),
        }).mei,
      )

    it('written as grace notes is supplied for notation', () => {
      const supplied = suppliedAround(asked('grace'), writtenIdOf(lean))
      expect(supplied?.getAttribute('reason')).toBe('notation')
      expect(supplied?.querySelector('[grace]')).not.toBeNull()
    })

    it('written as a sign is supplied for notation', () => {
      const supplied = asked('sign').querySelector('mordent')?.parentElement
      expect(supplied?.localName).toBe('supplied')
      expect(supplied?.getAttribute('reason')).toBe('notation')
      expect(supplied?.getAttribute('cert')).toBe('high')
    })
  })
})

describe('what the recording settles', () => {
  const noneSupplied = (mei: string) => {
    const doc = parse(mei)
    expect(doc.querySelector('app[type="transcription"]')).not.toBeNull()
    expect(doc.querySelector('supplied')).toBeNull()
  }

  it('stands in the reading as it is: a note added to a written chord', () => {
    const octave = span('x1', 5, 36)
    noneSupplied(
      transcribe({ mei: aligned(scoreMei(), { extra: [octave] }), source: SOURCE, divergences: [added('a', [octave], 'added-octave')], spans: [octave] }).mei,
    )
  })

  it('a note not played', () => {
    noneSupplied(transcribe({ mei: aligned(scoreMei(), { unplayed: ['n6'] }), source: SOURCE, divergences: [missing('m', ['n6'])], spans: [] }).mei)
  })

  it('a note played at another pitch', () => {
    const sharp = span('x1', 2000, 78)
    noneSupplied(
      transcribe({ mei: aligned(scoreMei(), { substituted: { n5: sharp } }), source: SOURCE, divergences: [replaced('r', 'n5', sharp, 77)], spans: [sharp] }).mei,
    )
  })

  it('a tie that was not held', () => {
    const tied = scoreMei()
      .replace('<note xml:id="n2" pname="d" oct="5" dur="4"/>', '<note xml:id="n2" pname="c" oct="5" dur="4"/>')
      .replace('</measure>', '<tie xml:id="t1" startid="#n1" endid="#n2"/></measure>')
    const { n2: _tiedInto, ...struckOnce } = PLAYED
    void _tiedInto
    const again = span('x1', 510, 72)
    noneSupplied(
      transcribe({ mei: aligned(tied, { played: struckOnce, extra: [again] }), source: SOURCE, divergences: [added('a', [again])], spans: [again] }).mei,
    )
  })

  it('and none of the readings says how sure it is on the reading itself, which MEI does not allow', () => {
    const passing = span('x1', 750, 73)
    const octave = span('x2', 5, 36)
    const doc = parse(
      transcribe({
        mei: aligned(scoreMei(), { extra: [passing, octave] }),
        source: SOURCE,
        divergences: [added('a', [passing]), added('b', [octave], 'added-octave')],
        spans: [passing, octave],
      }).mei,
    )
    expect(doc.querySelectorAll('rdg').length).toBeGreaterThan(0)
    expect(doc.querySelector('rdg[cert]')).toBeNull()
  })
})

describe('who answers for it', () => {
  const passing = span('x1', 750, 73)
  const octave = span('x2', 5, 36)
  const input = (mei = scoreMei()) => ({
    mei: aligned(mei, { extra: [passing, octave] }),
    source: SOURCE,
    divergences: [added('a', [passing]), added('b', [octave], 'added-octave')],
    spans: [passing, octave],
  })
  const NAME = 'A. N. Editor'

  it('is pointed at where the header names them, and the header is made to', () => {
    const doc = parse(transcribe({ ...input(), resp: NAME }).mei)

    const editor = doc.querySelector('meiHead > fileDesc > titleStmt > editor')
    expect(editor?.getAttribute('xml:id')).toBe('editor')
    expect(editor?.textContent).toBe(NAME)
    for (const element of doc.querySelectorAll('rdg[source="performance"], supplied')) {
      expect(element.getAttribute('resp')).toBe('#editor')
    }
    expect(doc.querySelector('supplied')).not.toBeNull()
  })

  it('is named once, however often the score is transcribed', () => {
    const once = transcribe({ ...input(), resp: NAME })
    const twice = transcribe({ ...input(), mei: once.mei, resp: NAME })
    expect(parse(twice.mei).querySelectorAll('titleStmt > editor')).toHaveLength(1)
    expect(canonical(twice.mei)).toBe(canonical(once.mei))
  })

  it('goes out of the header with the readings', () => {
    const base = aligned(scoreMei(), { extra: [passing, octave] })
    expect(canonical(untranscribed(transcribe({ ...input(), resp: NAME }).mei))).toBe(canonical(base))
  })

  it('is named on a line of its own in a header laid out in lines, and the line goes with it', () => {
    const laidOut = scoreMei().replace('<titleStmt><title/></titleStmt>', '<titleStmt>\n      <title/>\n    </titleStmt>')
    const result = transcribe({ ...input(laidOut), resp: NAME })

    expect(result.mei).toContain(`<title/>\n      <editor xml:id="editor" type="transcription">${NAME}</editor>\n    </titleStmt>`)
    expect(untranscribed(result.mei)).toContain('<titleStmt>\n      <title/>\n    </titleStmt>')
  })

  it('is the editor the header already names, where it does', () => {
    const named = scoreMei().replace('<title/>', `<title/><editor xml:id="ed1">${NAME}</editor>`)
    const result = transcribe({ ...input(named), resp: NAME })
    const doc = parse(result.mei)

    expect(doc.querySelectorAll('titleStmt > editor')).toHaveLength(1)
    expect(doc.querySelector('rdg[source="performance"]')?.getAttribute('resp')).toBe('#ed1')
    // And it was the source's, so it stays when the readings go
    expect(parse(untranscribed(result.mei)).querySelector('titleStmt > editor[*|id="ed1"]')).not.toBeNull()
  })

  it('is given another id where the score already has one called editor', () => {
    const taken = scoreMei().replace('<title/>', '<title xml:id="editor"/>')
    const doc = parse(transcribe({ ...input(taken), resp: NAME }).mei)
    expect(doc.querySelector('titleStmt > editor')?.getAttribute('xml:id')).toBe('editor-2')
    expect(doc.querySelector('supplied')?.getAttribute('resp')).toBe('#editor-2')
  })

  it('is not attributed at all where the header has nowhere to name them', () => {
    const headless = scoreMei().replace(/<meiHead>.*<\/meiHead>/, '')
    const doc = parse(transcribe({ ...input(headless), resp: NAME }).mei)
    expect(doc.querySelector('[resp]')).toBeNull()
    expect(doc.querySelector('editor')).toBeNull()
  })

  it('leaves a header alone where nothing was written', () => {
    const result = transcribe({ mei: aligned(scoreMei()), source: SOURCE, divergences: [], spans: [], resp: NAME })
    expect(parse(result.mei).querySelector('editor')).toBeNull()
  })
})

describe('the supplied notation, settled for conversion', () => {
  // A note in a voice of its own in the first bar, which espressivo has to start at the barline
  const passing = span('x1', 750, 73, 250)
  const transcribed = transcribe({
    mei: aligned(scoreMei(), { extra: [passing] }),
    source: SOURCE,
    divergences: [added('a', [passing])],
    spans: [passing],
    resp: 'A. N. Editor',
  }).mei

  it('is given up, keeping what it holds', () => {
    const doc = parse(performanceReading(transcribed))
    expect(doc.querySelector('supplied')).toBeNull()
    expect(doc.querySelector(`staff > layer > [*|id="${writtenIdOf(passing)}"]`)).not.toBeNull()
  })

  it('puts a voice of its own where it was written, and every bar after it where it was', () => {
    expect(parse(transcribed).querySelector('supplied > layer')).not.toBeNull()

    const movement = convertMeiToMsm(performanceReading(transcribed))[0]!
    const takes = asMSM(transcribed, movement.msm, movement.graces)
    const row = (id: string) => takes.allNotes.find((note) => note['xml:id'] === id)
    const ppq = row('n2')!.date - row('n1')!.date

    expect(row(writtenIdOf(passing))!.date).toBe(row('n2')!.date + ppq / 2)
    expect(row('n5')!.date).toBe(row('n1')!.date + 4 * ppq)
  })
})
