// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { MidiFile } from 'midifile-ts'
import { applyAlignment } from '../../src/alignment/applyAlignment'
import { parseRecordings } from '../../src/mei/parseRecordings'
import { ORNAMENT_ANCHOR_CONFIDENCE_OF } from '../../src/mei/when'
import { buildMidiFile } from '../../src/performance/buildMidiFile'
import { asSpans, type NoteSpan } from '../../src/performance/midiSpans'
import { loadVerovio, renderPerformance } from '../../src/verovio/toolkit'
import type { Divergence } from '../../src/alignment/divergences'
import type { VerovioToolkit } from 'verovio/esm'

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')

let midi: MidiFile
let spans: NoteSpan[]
let scoreId: string
let otherScoreId: string
/** The take being written: the one this MIDI was built from, so each run replaces it in place. */
let source: string

beforeAll(() => {
  const { recordings, pitchMap } = parseRecordings(mei)
  midi = buildMidiFile(recordings[0], pitchMap)
  source = recordings[0].source
  spans = asSpans(midi, true).filter((s): s is NoteSpan => s.type === 'note')

  const ids = [...recordings[0].noteSpans.keys()]
  scoreId = ids[0]
  otherScoreId = ids[1]
})

const added = (perfIds: string[], anchorId: string | null): Divergence => ({
  kind: 'added',
  id: 'added-0',
  perfIds,
  pitches: perfIds.map(() => 60),
  anchorId,
  anchorFrom: anchorId ? 'model' : null,
  anchorConfidence: anchorId ? 0.88 : undefined,
  signs: [],
  reading: 'written-ornament',
  because: 'the score writes a trill here',
  onsetMs: 0,
  confidence: 0.42,
})

/**
 * The divergences of whichever recording holds them.
 *
 * `insertRecording` appends into the first <performance>, and transcription.mei
 * has more than one, so the recording just written is not the last in the
 * document - looking there finds nothing.
 */
const divergencesIn = (doc: string) =>
  parseRecordings(doc).recordings.flatMap((r) => r.divergences)

const replaced = (scoreId: string, perfId: string, pitches: [number, number]): Divergence => ({
  kind: 'replaced',
  id: 'replaced-missing-0',
  scoreId,
  perfId,
  pitches,
  reading: 'neighbour-slip',
  because: 'a semitone above the written note',
  onset: 0,
  onsetMs: 0,
  lateMs: 12,
  confidence: 0.27,
})

const missing = (scoreIds: string[]): Divergence => ({
  kind: 'missing',
  id: 'missing-0',
  scoreIds,
  reading: 'thinned-chord',
  because: 'the rest of the chord was played',
  onset: 0,
  confidence: 0.31,
})

describe('writing divergences into the recording', () => {
  it('gives a played note with no score note a <when> with no @data', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], scoreId)],
    })

    const doc = new DOMParser().parseFromString(result, 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()

    const when = doc.querySelector('when[type="insertion"]')
    expect(when).not.toBeNull()
    expect(when!.hasAttribute('data')).toBe(false)
    expect(when!.getAttribute('absolute')).toBe(`${spans[0].onsetMs.toFixed(0)}ms`)
  })

  it('gives a written note that was never played a <when> with no @absolute', () => {
    const result = applyAlignment(mei, midi, [], { source, divergences: [missing([scoreId])] })

    const when = new DOMParser()
      .parseFromString(result, 'application/xml')
      .querySelector('when[type="deletion"]')

    expect(when).not.toBeNull()
    expect(when!.getAttribute('data')).toBe(`#${scoreId}`)
    expect(when!.hasAttribute('absolute')).toBe(false)
  })

  it('carries the ornament anchor under espressivo’s own name', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id, spans[1].id], scoreId)],
    })

    const doc = new DOMParser().parseFromString(result, 'application/xml')
    const anchors = [...doc.querySelectorAll('extData[type="ornamentAnchor"]')]
    expect(anchors).toHaveLength(2)
    expect(anchors[0].textContent).toBe(`#${scoreId}`)

    // The slot numbers the note's place in the figure, as espressivo's does
    const slots = [...doc.querySelectorAll('extData[type="ornamentSlot"]')].map(
      (s) => s.textContent
    )
    expect(slots).toEqual(['0', '1'])
  })

  it('says whether the model named the anchor or the timing was guessed from', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], scoreId)],
    })

    const found = divergencesIn(result).find((d) => d.kind === 'insertion')
    expect(found?.ornamentAnchorFrom).toBe('model')
    expect(found?.ornamentAnchorConfidence).toBeCloseTo(0.88, 3)
  })

  it('leaves the provenance out where there is no anchor to have one', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], null)],
    })

    expect(result).not.toContain('ornamentAnchorFrom')
  })

  /**
   * An edition outlives the code that wrote it, and this number has changed
   * meaning once already: it used to carry the match head's P(insertion) too.
   * Both readings are probabilities and the newer is always the larger, so
   * without a token beside it a reader has nothing to tell them apart by.
   */
  it('names which quantity the anchor confidence is', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], scoreId)],
    })

    const found = divergencesIn(result).find((d) => d.kind === 'insertion')
    expect(found?.ornamentAnchorConfidenceOf).toBe(ORNAMENT_ANCHOR_CONFIDENCE_OF)
    expect(found?.ornamentAnchorConfidenceOf).toBe('anchor-given-insertion')
  })

  it('never writes the number without saying which number it is', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], scoreId), added([spans[1].id], null)],
    })

    const numbers = result.match(/type="ornamentAnchorConfidence"/g) ?? []
    const labels = result.match(/type="ornamentAnchorConfidenceOf"/g) ?? []
    expect(numbers.length).toBeGreaterThan(0)
    expect(labels).toHaveLength(numbers.length)
  })

  /**
   * The point of the token is that a file predating it still reads, and reads
   * as the older quantity. Absence is the reading, not a gap to be filled in.
   */
  it('reads a file written before the token, and leaves it unlabelled', () => {
    const withToken = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], scoreId)],
    })
    const asItWasWritten = withToken.replace(
      /\s*<extData type="ornamentAnchorConfidenceOf">[^<]*<\/extData>/g,
      ''
    )
    expect(asItWasWritten).not.toContain('ornamentAnchorConfidenceOf')

    const found = divergencesIn(asItWasWritten).find((d) => d.kind === 'insertion')
    expect(found?.ornamentAnchorConfidenceOf).toBeUndefined()
    expect(found?.ornamentAnchorConfidence).toBeCloseTo(0.88, 3)
    expect(found?.ornamentAnchor).toBe(scoreId)
  })

  it('leaves out a deletion against a note the document does not hold', () => {
    const result = applyAlignment(mei, midi, [], { source, divergences: [missing(['no-such-note'])] })

    expect(result).not.toContain('no-such-note')
  })

  it('reads both shapes back out again', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], scoreId), missing([otherScoreId])],
    })

    const found = divergencesIn(result)

    const insertion = found.find((d) => d.kind === 'insertion')
    expect(insertion?.span?.pitch).toBe(spans[0].pitch)
    expect(insertion?.ornamentAnchor).toBe(scoreId)
    expect(insertion?.reading).toBe('written-ornament')
    expect(insertion?.confidence).toBeCloseTo(0.42, 3)

    const deletion = found.find((d) => d.kind === 'deletion')
    expect(deletion?.scoreId).toBe(otherScoreId)
    expect(deletion?.reading).toBe('thinned-chord')
  })

  it('gives a written note played as another note a <when> carrying both', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [replaced(scoreId, spans[0].id, [60, 61])],
    })

    const doc = new DOMParser().parseFromString(result, 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()

    // The one shape with a note *and* a moment that is still not a match: what
    // differs is the pitch, so the pitch actually sounded is what it carries
    const when = doc.querySelector('when[type="substitution"]')
    expect(when).not.toBeNull()
    expect(when!.getAttribute('data')).toBe(`#${scoreId}`)
    expect(when!.getAttribute('absolute')).toBe(`${spans[0].onsetMs.toFixed(0)}ms`)
    expect(when!.querySelector('extData[type="pitch"]')?.textContent).toBe(
      String(spans[0].pitch)
    )
    expect(when!.querySelector('extData[type="writtenPitch"]')?.textContent).toBe('60')
  })

  it('reads a substitution back as both a divergence and a note that sounded', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [replaced(scoreId, spans[0].id, [60, spans[0].pitch])],
    })

    const { recordings } = parseRecordings(result)
    const found = recordings
      .flatMap((r) => r.divergences)
      .find((d) => d.kind === 'substitution')

    expect(found?.scoreId).toBe(scoreId)
    expect(found?.span?.pitch).toBe(spans[0].pitch)
    expect(found?.writtenPitch).toBe(60)
    expect(found?.reading).toBe('neighbour-slip')

    // It sounded, so it belongs among the spans as well as among the disagreements
    const carrying = recordings.find((r) => r.noteSpans.has(scoreId))
    expect(carrying?.noteSpans.get(scoreId)?.onsetMs).toBe(spans[0].onsetMs)
  })

  it('writes a pair the reader confirmed the aligner should have made as a plain match', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [replaced(scoreId, spans[0].id, [60, 60])],
      resolutions: new Map([
        ['replaced-missing-0', { reading: 'unmatched-pair', action: 'count-as-played' }],
      ]),
    })

    const doc = new DOMParser().parseFromString(result, 'application/xml')
    expect(doc.querySelector('when[type="substitution"]')).toBeNull()

    const when = doc.querySelector(`when[data="#${scoreId}"]`)
    expect(when).not.toBeNull()
    expect(when!.hasAttribute('type')).toBe(false)
    expect(when!.getAttribute('absolute')).toBe(`${spans[0].onsetMs.toFixed(0)}ms`)
  })

  it('records the reading the reader settled on rather than the proposed one', () => {
    const result = applyAlignment(mei, midi, [], {
      source,
      divergences: [added([spans[0].id], scoreId)],
      resolutions: new Map([
        ['added-0', { reading: 'added-octave', resp: 'NP', certainty: 'high' }],
      ]),
    })

    const insertion = divergencesIn(result)[0]

    expect(insertion.reading).toBe('added-octave')
    expect(insertion.resp).toBe('NP')
    expect(insertion.certainty).toBe('high')
  })
})

describe('the vendored fork, given those <when>s in the recording it lays out from', () => {
  let tk: VerovioToolkit

  beforeAll(async () => {
    tk = await loadVerovio()
  }, 60_000)

  /** Every notehead's x, keyed by the id verovio drew it under. */
  const noteheadXs = (doc: string) => {
    const pages = renderPerformance(tk, doc, { performanceRecording: '1' })
    const xs = new Map<string, number>()
    for (const page of pages) {
      const parsed = new DOMParser().parseFromString(page, 'text/html')
      for (const note of parsed.querySelectorAll('.note')) {
        const id = note.getAttribute('data-id')
        const t = note
          .querySelector('.notehead use')
          ?.getAttribute('transform')
          ?.match(/translate\(\s*([-0-9.]+)/)
        if (id && t) xs.set(id, Number(t[1]))
      }
    }
    return xs
  }

  // This is the licence for putting divergences in the very recording the score
  // is laid out from, rather than in a second one: the fork ignores a <when> it
  // cannot resolve, so nothing moves.
  it('draws every notehead in exactly the place it did without them', () => {
    const pairs = [...parseRecordings(mei).recordings[0].noteSpans.entries()]
      .slice(0, 20)
      .map(([score_id, span]) => ({ score_id, performance_id: span.id }))

    const before = applyAlignment(mei, midi, pairs, { source })
    const after = applyAlignment(mei, midi, pairs, {
      source,
      divergences: [added([spans[0].id, spans[1].id], scoreId), missing([otherScoreId])],
    })

    const drawnBefore = noteheadXs(before)
    const drawnAfter = noteheadXs(after)

    expect(drawnBefore.size).toBeGreaterThan(10)
    expect(drawnAfter.size).toBe(drawnBefore.size)
    for (const [id, x] of drawnBefore) expect(drawnAfter.get(id)).toBeCloseTo(x, 5)
  }, 60_000)

  // And this is the licence for giving a substitution both @data and @absolute:
  // the note did sound, so it should be laid out where it sounded rather than
  // left behind with the notes the recording never reached.
  it('lays a substitution out exactly where the same note as a plain match is laid out', () => {
    const pairs = [...parseRecordings(mei).recordings[0].noteSpans.entries()]
      .slice(0, 20)
      .map(([score_id, span]) => ({ score_id, performance_id: span.id }))

    const asMatch = applyAlignment(mei, midi, pairs, { source })
    const asSubstitution = applyAlignment(mei, midi, pairs.slice(1), {
      source,
      divergences: [replaced(pairs[0].score_id, pairs[0].performance_id, [60, 61])],
    })

    const drawnAsMatch = noteheadXs(asMatch)
    const drawnAsSubstitution = noteheadXs(asSubstitution)

    expect(drawnAsMatch.has(pairs[0].score_id)).toBe(true)
    for (const [id, x] of drawnAsMatch) expect(drawnAsSubstitution.get(id)).toBeCloseTo(x, 5)
  }, 60_000)
})
