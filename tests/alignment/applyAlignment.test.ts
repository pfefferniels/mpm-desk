// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { MidiFile } from 'midifile-ts'
import { applyAlignment } from '../../src/alignment/applyAlignment'
import { parseRecordings } from '../../src/mei/parseRecordings'
import { buildMidiFile } from '../../src/performance/buildMidiFile'
import { asSpans } from '../../src/performance/midiSpans'

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')

let midi: MidiFile
/** A note the document really holds, and a performed note to align it to */
let scoreId: string
let performanceId: string
/** The take being written: the one this MIDI was built from, so each run replaces it in place. */
let source: string

beforeAll(() => {
  const { recordings, pitchMap } = parseRecordings(mei)
  midi = buildMidiFile(recordings[0], pitchMap)
  source = recordings[0].source

  scoreId = [...recordings[0].noteSpans.keys()][0]
  performanceId = asSpans(midi, true).filter((span) => span.type === 'note')[0].id
})

describe('writing an alignment into the MEI', () => {
  it('gives a matched note a <when> pointing at it', () => {
    const result = applyAlignment(mei, midi, [{ score_id: scoreId, performance_id: performanceId }], {
      source,
    })

    expect(result).toContain(`data="#${scoreId}"`)
    expect(new DOMParser().parseFromString(result, 'application/xml').querySelector('parsererror'))
      .toBeNull()
  })

  it('leaves out a match against an element the document does not contain', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Verovio names material it unfolds itself, e.g. the second pass through a
    // repeated section, and those ids need not exist in the document it read
    const invented = `${scoreId}-rend7`
    const result = applyAlignment(mei, midi, [{ score_id: invented, performance_id: performanceId }], {
      source,
    })

    expect(result).not.toContain(`data="#${invented}"`)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('keeps the good matches when one of them is unknown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = applyAlignment(
      mei,
      midi,
      [
        { score_id: scoreId, performance_id: performanceId },
        { score_id: 'no-such-note', performance_id: performanceId },
      ],
      { source },
    )

    expect(result).toContain(`data="#${scoreId}"`)
    expect(result).not.toContain('no-such-note')
    warn.mockRestore()
  })
})

/**
 * A document holds one `<recording>` per take, and which one a passage is read from is a decision
 * made later — by a `MakeChoice`, and by verovio's `performanceRecording` when the score is drawn.
 * Both select by `@source`, so the name is what makes a second take possible at all.
 */
describe('two takes of the same score', () => {
  const sourcesOf = (xml: string) =>
    [...new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('recording')].map(
      (recording) => recording.getAttribute('source'),
    )

  it('stand side by side, each under its own name', () => {
    const { recordings, pitchMap } = parseRecordings(mei)
    expect(recordings.length).toBeGreaterThan(1)

    const second = buildMidiFile(recordings[1], pitchMap)
    const secondId = [...recordings[1].noteSpans.keys()][0]
    const secondPerformanceId = asSpans(second, true).filter((s) => s.type === 'note')[0].id

    const written = applyAlignment(
      applyAlignment(mei, midi, [{ score_id: scoreId, performance_id: performanceId }], { source }),
      second,
      [{ score_id: secondId, performance_id: secondPerformanceId }],
      { source: recordings[1].source },
    )

    expect(sourcesOf(written)).toEqual([source, recordings[1].source])
  })

  it('replaces the take it names rather than the one that happens to be first', () => {
    const twice = applyAlignment(
      applyAlignment(mei, midi, [{ score_id: scoreId, performance_id: performanceId }], { source }),
      midi,
      [{ score_id: scoreId, performance_id: performanceId }],
      { source },
    )

    // Written twice, and the document still holds the takes it started with, in the order it
    // held them — `performanceRecording` will take an index, so the order is nameable too
    expect(sourcesOf(twice)).toEqual(sourcesOf(mei))
  })
})
