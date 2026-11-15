import { describe, expect, it } from 'vitest'
import { convertMeiToMsm } from 'espressivo'
import { recordedAlignment } from '../../../src/alignment/recorded'
import { transcribe, untranscribed, writtenIdOf, type Notation } from '../../../src/alignment/transcription'
import { asMSM } from '../../../src/fitting/asMSM'
import { parseRecordings } from '../../../src/mei/parseRecordings'
import { performanceReading } from '../../../src/mei/performanceReading'
import { strictRecordings } from '../../../src/alignment/transcription/strictRecordings'
import { insertInsertionWhen } from '../../../src/mei/when'
import type { NoteSpan } from '../../../src/performance/midiSpans'
import { PLAYED, SOURCE, added, aligned, canonical, missing, parse, replaced, scoreMei, span } from './fixture'

/**
 * What is saved, and what comes back of it.
 *
 * While a reader works the recording holds what the aligner could not pair. A saved document is
 * an as-played-by one and holds none of that: a record is a note that sounded or a pedal press,
 * and what the performer did differently is in the score. Reopened, the desk has to find its
 * working form again in the score alone, and transcribe it to the document that was saved.
 */

const whensOf = (mei: string) => [...parse(mei).querySelectorAll('recording > when')]
const dataOf = (when: Element, type: string) => when.querySelector(`extData[type="${type}"]`)?.textContent ?? null

/** Every record of a note, as the format states it: what it points at, when, and at what pitch. */
const records = (mei: string) =>
  whensOf(mei)
    .filter((when) => when.getAttribute('type') === 'match')
    .map((when) => `${when.getAttribute('data')} ${when.getAttribute('absolute')} ${dataOf(when, 'pitch') ?? '-'}`)
    .sort()

/**
 * The score aligned, with a figure the aligner put on one of its notes.
 *
 * As `applyAlignment` writes it: each note of the figure is a played note with no written one,
 * and says which written note it is played around.
 */
const figuredOn = (mei: string, anchor: string, figure: NoteSpan[]): string => {
  const doc = parse(aligned(mei))
  const recording = doc.querySelector('recording')!
  for (const note of figure) {
    insertInsertionWhen(doc, recording, note, { ornamentAnchor: anchor, ornamentAnchorFrom: 'model' })
  }
  return new XMLSerializer().serializeToString(doc)
}

// One of everything: a note added, a note left out, a chord thinned, a note played otherwise
const extras = [span('x1', 5, 36), span('x2', 750, 73)]
const sharp = span('x4', 2000, 78)
const base = aligned(scoreMei(), { extra: extras, unplayed: ['n6', 'n4'], substituted: { n5: sharp } })
const divergences = [
  ...extras.map((extra, index) => added(`a${index}`, [extra])),
  missing('m1', ['n6']),
  missing('m2', ['n4'], 'thinned-chord'),
  replaced('r', 'n5', sharp, 77),
]
const spans = [...extras, sharp]
const worked = transcribe({ mei: base, source: SOURCE, divergences, spans })
const saved = strictRecordings(worked.mei)

describe('a saved recording', () => {
  it('holds notes that sounded and nothing else', () => {
    const whens = whensOf(saved)

    expect(whens.length).toBeGreaterThan(0)
    expect(new Set(whens.map((when) => when.getAttribute('type')))).toEqual(new Set(['match']))
    for (const when of whens) {
      expect(when.getAttribute('data')).toMatch(/^#/)
      expect(when.getAttribute('absolute')).toMatch(/^\d+ms$/)
    }
  })

  it('points every record at a note the score holds', () => {
    const doc = parse(saved)
    for (const when of whensOf(saved)) {
      const id = when.getAttribute('data')?.slice(1)
      expect(doc.querySelector(`note[*|id="${id}"]`), id).not.toBeNull()
    }
  })

  it('says a note was not played by pointing nothing at it', () => {
    expect(parse(worked.mei).querySelectorAll('when[type="deletion"]')).toHaveLength(2)

    const doc = parse(saved)
    expect(doc.querySelector('when[data="#n6"]')).toBeNull()
    expect(doc.querySelector('when[data="#n4"]')).toBeNull()
    // The score says so instead: the note is in the reading of the source, and not in the other
    expect(doc.querySelector('rdg[source="original"] [*|id="n6"]')).not.toBeNull()
  })

  it('points at the note written for what was played, and no longer at the note it replaced', () => {
    const doc = parse(saved)
    const when = doc.querySelector(`when[data="#${writtenIdOf(sharp)}"]`)

    expect(when?.getAttribute('absolute')).toBe('2000ms')
    expect(doc.querySelector('when[data="#n5"]')).toBeNull()
    // One record on one note is that note, at the pitch the score writes
    expect(dataOf(when!, 'pitch')).toBeNull()
  })

  it('carries nothing of the review: no mark, no confidence, no reading', () => {
    const types = new Set(
      [...parse(saved).querySelectorAll('when > extData')].map((data) => data.getAttribute('type')),
    )
    expect([...types].sort()).toEqual(['duration', 'durationTicks', 'onsetTicks', 'velocity'])
  })

  it('is left as it is when saved again', () => {
    expect(canonical(strictRecordings(saved))).toBe(canonical(saved))
  })
})

describe('a saved recording, reopened', () => {
  it('gives the aligner\'s findings back from the score alone', () => {
    const recording = parseRecordings(untranscribed(saved)).recordings[0]
    const { matches, deletions, insertions } = recordedAlignment(recording)

    // What was played with no written note: the two added notes and the one played otherwise
    expect(
      recording.divergences
        .filter((entry) => entry.kind === 'insertion')
        .map((entry) => `${entry.span?.onsetMs} ${entry.span?.pitch}`)
        .sort(),
    ).toEqual(['2000 78', '5 36', '750 73'])
    expect(insertions).toHaveLength(3)

    // What was written and not played, the replaced note among them
    expect(deletions.map((entry) => entry.scoreId).sort()).toEqual(['n4', 'n5', 'n6'])
    expect(matches.map((entry) => entry.scoreId).sort()).toEqual(
      Object.keys(PLAYED)
        .filter((id) => !['n4', 'n5', 'n6'].includes(id))
        .sort(),
    )
  })

  it('takes the readings out of the score again', () => {
    const doc = parse(untranscribed(saved))
    expect(doc.querySelector('app[type="transcription"]')).toBeNull()
    expect(doc.querySelectorAll('note')).toHaveLength(parse(scoreMei()).querySelectorAll('note').length)
  })

  it('is transcribed to the document that was saved', () => {
    const again = transcribe({ mei: saved, source: SOURCE, divergences, spans })

    expect(again.readings).toEqual(worked.readings)
    expect(canonical(strictRecordings(again.mei))).toBe(canonical(saved))
  })

  it('leaves a document still in work alone', () => {
    expect(canonical(untranscribed(worked.mei))).toBe(canonical(base))
    expect(untranscribed(base)).toBe(base)
  })
})

describe('an ornament', () => {
  // A turn around the d5 of bar 2, which the aligner matched at 3000 ms
  const figure = [span('x1', 2940, 76), span('x2', 3060, 72), span('x3', 3120, 74)]
  const ornamented = figuredOn(scoreMei(), 'n7', figure)
  const figured = [added('a', figure, 'ornamentation', 'n7')]
  const ask = (notation: Notation) =>
    transcribe({
      mei: ornamented,
      source: SOURCE,
      divergences: figured,
      spans: figure,
      choices: new Map([['a', notation]]),
    })

  describe('written as a sign', () => {
    const asSign = ask('sign')
    const savedSign = strictRecordings(asSign.mei)

    it('is saved as several records on the note the sign stands on, each with its pitch', () => {
      expect(records(savedSign).filter((record) => record.startsWith('#n7 '))).toEqual([
        '#n7 2940ms 76',
        '#n7 3000ms 74',
        '#n7 3060ms 72',
        '#n7 3120ms 74',
      ])
      expect(parse(savedSign).querySelector('when[type="insertion"]')).toBeNull()
    })

    it('leaves every other note with one record and no pitch', () => {
      const others = records(savedSign).filter((record) => !record.startsWith('#n7 '))
      expect(others).toHaveLength(Object.keys(PLAYED).length - 1)
      for (const record of others) expect(record).toMatch(/ -$/)
    })

    it('reaches the chain as one note, from where the figure begins to where it ends', () => {
      const movement = convertMeiToMsm(performanceReading(savedSign))[0]!
      const rows = asMSM(savedSign, movement.msm, movement.graces).allNotes.filter((note) => note['xml:id'] === 'n7')

      // The score has one note there. It falls where the earliest of its records does and
      // sounds until the last of them is let go: the d5 itself, struck at 3000 and held 450
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ 'midi.pitch': 74, 'milliseconds.date': 2940, 'milliseconds.date.end': 3450 })
    })

    it('comes back as the note and the figure played around it', () => {
      const recording = parseRecordings(untranscribed(savedSign)).recordings[0]

      expect(recording.noteSpans.get('n7')?.onsetMs).toBe(3000)
      expect(
        recording.divergences.map((entry) => `${entry.kind} ${entry.span?.onsetMs} ${entry.span?.pitch} ${entry.ornamentAnchor}`),
      ).toEqual(['insertion 2940 76 n7', 'insertion 3060 72 n7', 'insertion 3120 74 n7'])
      // Named, not guessed: the grouping asks which note the figure is on and gets its answer
      expect(recordedAlignment(recording).insertions.every((entry) => entry.ornamentOf?.scoreId === 'n7')).toBe(true)
    })

    it('is transcribed to the document that was saved', () => {
      const again = transcribe({
        mei: savedSign,
        source: SOURCE,
        divergences: figured,
        spans: figure,
        choices: new Map([['a', 'sign']]),
      })

      expect(again.outcomes.get('a')?.written).toBe('sign')
      expect(canonical(strictRecordings(again.mei))).toBe(canonical(savedSign))
    })
  })

  describe('the score writes as a sign of its own', () => {
    const signed = scoreMei().replace('</measure>\n    </section>', '<trill startid="#n7"/></measure>\n    </section>')
    const played = transcribe({
      mei: figuredOn(signed, 'n7', figure),
      source: SOURCE,
      divergences: [added('a', figure, 'written-ornament', 'n7')],
      spans: figure,
    })

    it('is saved the same way, with nothing written into the score', () => {
      expect(signed).toContain('<trill startid="#n7"/>')
      expect(played.outcomes.get('a')?.written).toBe('none')

      const savedTrill = strictRecordings(played.mei)
      expect(savedTrill).not.toContain('type="transcription"')
      expect(records(savedTrill).filter((record) => record.startsWith('#n7 '))).toHaveLength(4)
    })
  })

  describe('on a note the key signature alters', () => {
    // In G major the f5 of bar 2 is an f sharp, and nothing on the note says so
    const inG = scoreMei().replace('keysig="0"', 'keysig="1s"')
    const shake = [span('x1', 2060, 79), span('x2', 2120, 78)]
    const result = transcribe({
      mei: figuredOn(inG, 'n5', shake),
      source: SOURCE,
      divergences: [added('a', shake, 'ornamentation', 'n5')],
      spans: shake,
      choices: new Map([['a', 'sign']]),
    })
    const savedInG = strictRecordings(result.mei)

    it('gives the note\'s own record the pitch it sounds at, not the one its name spells', () => {
      expect(inG).toContain('keysig="1s"')
      expect(records(savedInG).filter((record) => record.startsWith('#n5 '))).toEqual([
        '#n5 2000ms 78',
        '#n5 2060ms 79',
        '#n5 2120ms 78',
      ])
    })

    it('finds that record again as the note itself', () => {
      const recording = parseRecordings(untranscribed(savedInG)).recordings[0]

      expect(recording.noteSpans.get('n5')?.onsetMs).toBe(2000)
      expect(recording.divergences.map((entry) => `${entry.span?.onsetMs} ${entry.span?.pitch}`)).toEqual([
        '2060 79',
        '2120 78',
      ])
    })
  })

  describe('written out as notes', () => {
    it('has one record for each note written', () => {
      const savedNotes = strictRecordings(ask('measured').mei)

      for (const note of figure) {
        expect(records(savedNotes)).toContain(`#${writtenIdOf(note)} ${String(note.onsetMs)}ms -`)
      }
      expect(records(savedNotes)).toContain('#n7 3000ms -')
    })
  })
})

describe('a played note the score has no place for', () => {
  // Played on a repeat the engraving shows once: there is no bar to write it into
  const pass = span('x1', 4200, 72)
  const result = transcribe({
    mei: figuredOn(scoreMei(), 'n7', [pass]),
    source: SOURCE,
    divergences: [added('a', [pass], 'repeat-pass', 'n7')],
    spans: [pass],
  })

  it('stays in the recording while the reader works', () => {
    expect(result.outcomes.get('a')?.written).toBe('none')
    expect(parse(result.mei).querySelectorAll('when[type="insertion"]')).toHaveLength(1)
  })

  it('is not saved: the format records no note the score does not write', () => {
    const savedPass = strictRecordings(result.mei)

    expect(whensOf(savedPass)).toHaveLength(Object.keys(PLAYED).length)
    expect(records(savedPass).some((record) => record.includes('4200ms'))).toBe(false)
  })
})

describe('a tie the performer did not hold', () => {
  const tied = scoreMei()
    .replace('<note xml:id="n2" pname="d" oct="5" dur="4"/>', '<note xml:id="n2" pname="c" oct="5" dur="4"/>')
    .replace('</measure>', '<tie xml:id="t1" startid="#n1" endid="#n2"/></measure>')
  const { n2: _tiedInto, ...struckOnce } = PLAYED
  void _tiedInto
  const again = span('x1', 510, 72)
  const struck = [added('a', [again])]
  const result = transcribe({ mei: aligned(tied, { played: struckOnce, extra: [again] }), source: SOURCE, divergences: struck, spans: [again] })
  const savedTie = strictRecordings(result.mei)

  it('is saved as a record on the note the tie ran into', () => {
    expect(records(savedTie)).toContain('#n2 510ms -')
  })

  it('comes back as a note struck where the score holds one', () => {
    const recording = parseRecordings(untranscribed(savedTie)).recordings[0]

    expect(recording.noteSpans.has('n2')).toBe(false)
    expect(recording.divergences.map((entry) => `${entry.kind} ${entry.span?.onsetMs} ${entry.span?.pitch}`)).toEqual([
      'insertion 510 72',
    ])
  })

  it('is transcribed to the document that was saved', () => {
    const second = transcribe({ mei: savedTie, source: SOURCE, divergences: struck, spans: [again] })

    expect(second.readings).toEqual(result.readings)
    expect(canonical(strictRecordings(second.mei))).toBe(canonical(savedTie))
  })
})
