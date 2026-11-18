import { describe, expect, it } from 'vitest'
import { recordedAlignment } from '../../src/alignment/recorded'
import { strictRecordings } from '../../src/alignment/transcription/strictRecordings'
import { insertRecording, insertWhen } from '../../src/mei/when'
import { parseRecordings } from '../../src/mei/parseRecordings'
import { SOURCE, scoreMei, span } from './transcription/fixture'

/**
 * How sure the model was of a match, kept while the reader works and dropped when the work is
 * saved.
 *
 * The desk writes a fresh run into the document a moment after it was made and from then on reads
 * the alignment back out of it. The page draws a doubtful match by the score rather than by the
 * moment it was struck, so the doubt has to come back out with it, or the page forgets it within
 * a second of aligning.
 */
const withMatches = (confidences: Record<string, number | undefined>): string => {
  const doc = new DOMParser().parseFromString(scoreMei(), 'application/xml')
  const recording = insertRecording(doc, SOURCE)!
  Object.entries(confidences).forEach(([id, confidence], at) => {
    insertWhen(doc, recording, span(`perf-${id}`, at * 500, 72, 400), id, confidence)
  })
  return new XMLSerializer().serializeToString(doc)
}

const matchesOf = (mei: string) =>
  recordedAlignment(parseRecordings(mei).recordings.find((entry) => entry.source === SOURCE)!).matches

describe('how sure the model was of a match', () => {
  it('comes back out of the document it was written into', () => {
    const matches = matchesOf(withMatches({ n1: 0.999, n2: 0.31 }))

    expect(matches.map(({ scoreId, confidence }) => [scoreId, confidence])).toEqual([
      ['n1', 0.999],
      ['n2', 0.31],
    ])
  })

  it('is taken as certainty where the document does not say', () => {
    expect(matchesOf(withMatches({ n1: undefined }))[0].confidence).toBe(1)
  })

  it('is not saved', () => {
    const saved = strictRecordings(withMatches({ n1: 0.999, n2: 0.31 }))

    expect(saved).not.toContain('type="confidence"')
    expect(matchesOf(saved).map((match) => match.confidence)).toEqual([1, 1])
  })
})
