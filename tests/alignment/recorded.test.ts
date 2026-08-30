// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { MidiFile } from 'midifile-ts'
import { applyAlignment } from '../../src/alignment/applyAlignment'
import { divergencesOf, type Divergence } from '../../src/alignment/divergences'
import { recordedAlignment } from '../../src/alignment/recorded'
import { parseRecordings } from '../../src/mei/parseRecordings'
import { ornamentSignsOf } from '../../src/mei/ornamentSigns'
import { buildMidiFile } from '../../src/performance/buildMidiFile'
import { asSpans, type NoteSpan } from '../../src/performance/midiSpans'
import { getNotesFromMEI, type ScoreNote } from '../../src/score/scoreNotes'

/**
 * The round trip a reopened project rests on.
 *
 * A reader's decisions are filed under divergence ids, and the work file holds them across a save.
 * For that to mean anything, opening the archive again has to produce *the same divergences* out
 * of the MEI alone — no model, no MIDI, no second run. This is the check that it does.
 */

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')

let scoreNotes: ScoreNote[]
let midi: MidiFile
let spans: NoteSpan[]
let source: string

beforeAll(async () => {
  scoreNotes = await getNotesFromMEI(mei, { collapseUnisons: false, notatedOnsets: true })
  const { recordings, pitchMap } = parseRecordings(mei)
  source = recordings[0].source
  midi = buildMidiFile(recordings[0], pitchMap)
  spans = asSpans(midi, true).filter((span): span is NoteSpan => span.type === 'note')
}, 120_000)

/**
 * A small alignment over real notes: most matched, a few not played, one note the score lacks.
 *
 * Paired by position rather than by what the original scan matched, because the point is the
 * shape of the three lists and the ids in them, not whether the pairing is musically right.
 */
const asAligned = () => {
  const notes = scoreNotes.slice(0, 30)
  const played = spans.slice(0, 30)

  const matches = notes.slice(0, 24).map((note, index) => ({
    scoreId: note.note,
    performanceId: played[index].id,
    confidence: 0.9,
  }))
  const deletions = notes.slice(24, 28).map((note) => ({ scoreId: note.note, confidence: 0.4 }))
  // Played notes nothing answers to, a long way after the matched ones so that they group alone
  const insertions = spans.slice(-2).map((span) => ({ performanceId: span.id, confidence: 0.3 }))

  return { matches, deletions, insertions }
}

const shapeOf = (divergences: readonly Divergence[]) =>
  divergences.map((divergence) => ({
    id: divergence.id,
    kind: divergence.kind,
    reading: divergence.reading,
  }))

describe('an alignment read back out of the recording it was written into', () => {
  it('gives the same divergences, and so the same names to file a decision under', () => {
    const { matches, deletions, insertions } = asAligned()

    const fresh = divergencesOf(
      { matches, deletions, insertions, scoreNotes, spans, signs: ornamentSignsOf(mei) },
      {},
    )
    expect(fresh.length).toBeGreaterThan(0)

    const written = applyAlignment(
      mei,
      midi,
      matches.map((m) => ({ score_id: m.scoreId, performance_id: m.performanceId })),
      { source, divergences: fresh },
    )

    const recording = parseRecordings(written).recordings.find((r) => r.source === source)!
    const back = recordedAlignment(recording)

    const reopened = divergencesOf(
      { ...back, scoreNotes, signs: ornamentSignsOf(written) },
      {},
    )

    expect(shapeOf(reopened)).toEqual(shapeOf(fresh))
  })

  it('reads a match back as a match, and says nothing about how sure it was', () => {
    const recording = parseRecordings(mei).recordings[0]
    const back = recordedAlignment(recording)

    expect(back.matches.length).toBe(recording.noteSpans.size)
    // A plain <when> carries no confidence, and nothing downstream reads a match's
    expect(new Set(back.matches.map((match) => match.confidence))).toEqual(new Set([1]))
  })

  it('splits a substitution back into the deletion and the insertion it was paired from', () => {
    const scoreId = scoreNotes[0].note
    const played = spans[1]

    const written = applyAlignment(mei, midi, [], {
      source,
      divergences: [
        {
          kind: 'replaced',
          id: `replaced-${scoreId}`,
          scoreId,
          perfId: played.id,
          pitches: [60, 61],
          reading: 'neighbour-slip',
          because: 'a semitone away',
          onset: 0,
          onsetMs: played.onsetMs,
          lateMs: 10,
          confidence: 0.5,
        },
      ],
    })

    const recording = parseRecordings(written).recordings.find((r) => r.source === source)!
    const back = recordedAlignment(recording)

    expect(back.deletions.map((d) => d.scoreId)).toContain(scoreId)
    expect(back.insertions).toHaveLength(1)

    // By the moment and the pitch, not by the id: `@corresp` names the symbol a note was
    // transcribed from wherever the file has one, so the played note comes back under a name of
    // its own. That is exactly what a divergence is no longer called after.
    const insertion = back.spans.find((span) => span.id === back.insertions[0].performanceId)!
    expect(Math.round(insertion.onsetMs)).toBe(Math.round(played.onsetMs))
    expect(insertion.pitch).toBe(played.pitch)
  })
})
