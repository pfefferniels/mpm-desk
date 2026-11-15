import { describe, expect, it } from 'vitest'
import { convertMeiToMsm } from 'espressivo'
import { transcribe, writtenIdOf } from '../../../src/alignment/transcription'
import { asMSM } from '../../../src/fitting/asMSM'
import { performanceReading } from '../../../src/mei/performanceReading'
import { SOURCE, added, aligned, missing, parse, scoreMei, span } from './fixture'

/**
 * What the transcription is for: the notes it writes have to reach the chain.
 *
 * The chain fits an MSM converted from the MEI, with the timing of each note read from the
 * `<when>` that points at it. A note in the score the conversion does not see is a note no
 * instruction can ever be fitted to, however well it was transcribed.
 */
const octave = span('x1', 5, 36)
const passing = span('x2', 750, 73)
const transcribed = transcribe({
  mei: aligned(scoreMei(), { extra: [octave, passing], unplayed: ['n6'] }),
  source: SOURCE,
  divergences: [added('a', [octave], 'added-octave'), added('b', [passing]), missing('m', ['n6'])],
  spans: [octave, passing],
}).mei

describe('the reading that was played, settled for conversion', () => {
  it('leaves a document with no readings in it exactly as it is', () => {
    expect(performanceReading(scoreMei())).toBe(scoreMei())
  })

  it('keeps the played reading and drops the source\'s', () => {
    const doc = parse(performanceReading(transcribed))

    expect(doc.querySelector('app')).toBeNull()
    expect(doc.querySelector('rdg')).toBeNull()
    expect(doc.querySelectorAll(`[*|id="${writtenIdOf(octave)}"]`)).toHaveLength(1)
    // The note joined by an octave stood in both readings and stands once now
    expect(doc.querySelectorAll('[*|id="b1"]')).toHaveLength(1)
    expect(doc.querySelector('[*|id="n6"]')).toBeNull()
  })

  it('is not what espressivo makes of the document unaided', () => {
    // Its converter takes the first reading, which is the source's: the octave is not there
    const unaided = convertMeiToMsm(transcribed)[0]!.msm
    expect(unaided).not.toContain(writtenIdOf(octave))
  })
})

describe('the transcribed notes, in the alignment the chain fits', () => {
  const movement = convertMeiToMsm(performanceReading(transcribed))[0]!
  const takes = asMSM(transcribed, movement.msm, movement.graces)
  const row = (id: string) => takes.allNotes.find((note) => note['xml:id'] === id)

  it('has the added notes, timed as they were played', () => {
    expect(row(writtenIdOf(octave))).toMatchObject({ 'midi.pitch': 36, 'milliseconds.date': 5 })
    expect(row(writtenIdOf(passing))).toMatchObject({ 'midi.pitch': 73, 'milliseconds.date': 750 })
  })

  it('has them where they were written: the octave on the downbeat, the passing note after the second beat', () => {
    const ppq = row('n2')!.date - row('n1')!.date
    expect(row(writtenIdOf(octave))!.date).toBe(row('b1')!.date)
    expect(row(writtenIdOf(passing))!.date).toBe(row('n2')!.date + ppq / 2)
  })

  it('does not have the note that was not played', () => {
    expect(row('n6')).toBeUndefined()
    expect(row('n7')).toBeDefined()
  })
})
