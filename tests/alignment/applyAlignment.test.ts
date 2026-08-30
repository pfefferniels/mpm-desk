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

beforeAll(() => {
  const { recordings, pitchMap } = parseRecordings(mei)
  midi = buildMidiFile(recordings[0], pitchMap)

  scoreId = [...recordings[0].noteSpans.keys()][0]
  performanceId = asSpans(midi, true).filter((span) => span.type === 'note')[0].id
})

describe('writing an alignment into the MEI', () => {
  it('gives a matched note a <when> pointing at it', () => {
    const result = applyAlignment(mei, midi, [{ score_id: scoreId, performance_id: performanceId }])

    expect(result).toContain(`data="#${scoreId}"`)
    expect(new DOMParser().parseFromString(result, 'application/xml').querySelector('parsererror'))
      .toBeNull()
  })

  it('leaves out a match against an element the document does not contain', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Verovio names material it unfolds itself, e.g. the second pass through a
    // repeated section, and those ids need not exist in the document it read
    const invented = `${scoreId}-rend7`
    const result = applyAlignment(mei, midi, [
      { score_id: invented, performance_id: performanceId },
    ])

    expect(result).not.toContain(`data="#${invented}"`)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('keeps the good matches when one of them is unknown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = applyAlignment(mei, midi, [
      { score_id: scoreId, performance_id: performanceId },
      { score_id: 'no-such-note', performance_id: performanceId },
    ])

    expect(result).toContain(`data="#${scoreId}"`)
    expect(result).not.toContain('no-such-note')
    warn.mockRestore()
  })
})
