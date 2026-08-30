// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MAX_CELLS,
  MismatchedPairError,
  alignScoreToPerformance,
  checkPerformance,
  checkScore,
  hasRepeatSigns,
  hasUntimedGraceNotes,
  orderPerformance,
  orderScore,
  toMatches,
  unshowableScoreIds,
  type MatchedNote,
} from '../../src/alignment/mlign'
import type { ScoreNote } from '../../src/score/scoreNotes'
import type { NoteSpan } from '../../src/performance/midiSpans'
// Types only: importing the module itself would pull onnxruntime-web into the run
import type { EncoderOutput, MlignSession, ModelFeeds } from '../../src/alignment/mlign/session'

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')

/** A repeat written the way a score writes one, rather than written out */
const withRepeatSigns = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
  <music><body><mdiv><score><scoreDef/><section>
    <measure xml:id="m1" n="1" left="rptstart" right="rptend">
      <staff n="1"><layer n="1"><note xml:id="n1" pname="c" oct="4" dur="4"/></layer></staff>
    </measure>
  </section></score></mdiv></body></music>
</mei>`

const match = (scoreId: string, confidence: number): MatchedNote => ({
  scoreId,
  performanceId: `p-${scoreId}`,
  confidence,
})

/** An id the flagship fixture really holds */
const knownId = (): string => {
  const found = /xml:id="(n[^"]+)"/.exec(mei)
  if (!found) throw new Error('no note id in the fixture')
  return found[1]
}

describe('the matches handed to applyAlignment', () => {
  it('renames the fields and keeps the order', () => {
    const pairs = toMatches([match('a', 0.9), match('b', 0.1)])

    expect(pairs).toEqual([
      { score_id: 'a', performance_id: 'p-a' },
      { score_id: 'b', performance_id: 'p-b' },
    ])
  })

  it('leaves out what the model was less sure of than asked', () => {
    const pairs = toMatches([match('a', 0.9), match('b', 0.1)], 0.5)

    expect(pairs.map((pair) => pair.score_id)).toEqual(['a'])
  })

  it('keeps a match exactly at the threshold', () => {
    expect(toMatches([match('a', 0.5)], 0.5)).toHaveLength(1)
  })
})

describe('matches the engraving cannot show', () => {
  it('finds none in a score whose repeat is written out', () => {
    // transcription.mei carries 130 note ids of its own ending in -rend2: the
    // suffix is verovio's naming for an unfolded pass, but here the elements
    // are really in the document, so every one of them can be shown
    const ids = [...mei.matchAll(/xml:id="(n[^"]*-rend2)"/g)].map((found) => found[1])
    expect(ids.length).toBeGreaterThan(0)

    const matches = [knownId(), ...ids.slice(0, 20)].map((id) => match(id, 1))
    expect(unshowableScoreIds(mei, matches).size).toBe(0)
  })

  it('finds the ids verovio minted for a repeat the document does not hold', () => {
    const invented = `${knownId()}-rend7`
    const unshowable = unshowableScoreIds(mei, [match(knownId(), 1), match(invented, 1)])

    expect([...unshowable]).toEqual([invented])
  })
})

describe('repeat signs', () => {
  it('are reported when the repeat is not written out', () => {
    expect(hasRepeatSigns(withRepeatSigns)).toBe(true)
  })

  it('are not reported for a score that writes its repeat out', () => {
    expect(hasRepeatSigns(mei)).toBe(false)
  })
})

const note = (onset: number, pitch: number, id?: string): ScoreNote => ({
  onset,
  duration: 1,
  pitch,
  note: id ?? `n${onset}-${pitch}`,
})

const span = (onsetMs: number, pitch: number, id?: string): NoteSpan => ({
  type: 'note',
  id: id ?? `s${onsetMs}-${pitch}`,
  onset: onsetMs,
  offset: onsetMs + 100,
  onsetMs,
  offsetMs: onsetMs + 100,
  pitch,
  velocity: 64,
  channel: 0,
})

describe('what is refused before the model is ever fetched', () => {
  it('says so when the score has no notes', async () => {
    await expect(alignScoreToPerformance([], [span(0, 60)])).rejects.toThrow(/score/)
  })

  it('says so when the MIDI file has no notes', async () => {
    await expect(alignScoreToPerformance([note(0, 60)], [])).rejects.toThrow(/MIDI/)
  })

  it('says so when the two tables are too large to hold', async () => {
    const size = Math.ceil(Math.sqrt(MAX_CELLS)) + 1
    const score = Array.from({ length: size }, (_, i) => note(i, 60))
    const perf = Array.from({ length: size }, (_, i) => span(i * 100, 60))

    await expect(alignScoreToPerformance(score, perf)).rejects.toThrow(/too large/)
  })

  it('stops on a pair that is not the same music, and runs when told to', async () => {
    // Long enough to be cut into windows, and with no pitch in common, so the
    // baseline finds nothing to anchor on and every window falls back to the
    // whole performance — the shape that makes the head's arithmetic worst.
    const score = Array.from({ length: 1200 }, (_, i) => note(i * 0.5, 60 + (i % 12)))
    const perf = Array.from({ length: 1200 }, (_, i) => span(i * 370, 30 + (i % 7)))

    await expect(alignScoreToPerformance(score, perf)).rejects.toThrow(MismatchedPairError)
    await expect(alignScoreToPerformance(score, perf)).rejects.toThrow(
      /does not look like a recording of this score/
    )

    // …and `allowMismatch` gets past it, to whatever comes next (here, no model)
    await expect(
      alignScoreToPerformance(score, perf, { allowMismatch: true })
    ).rejects.not.toThrow(MismatchedPairError)
  })

  it('says so when every note of the score is unreadable', async () => {
    // What a note verovio cannot sound comes back as: getMIDIValuesForElement
    // returned nothing and the pitch is NaN
    const score = [note(0, NaN), note(1, NaN)]

    await expect(alignScoreToPerformance(score, [span(0, 60)])).rejects.toThrow(
      /None of the 2 notes in the score/
    )
  })
})

describe('reading a file before anything expensive touches it', () => {
  const midi = readFileSync(
    join(__dirname, 'welte-red_midi-exp_wv912mm2332_exp(1).mid')
  )
  const bytesOf = (buffer: Buffer): ArrayBuffer =>
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

  it('accepts a real MIDI file', () => {
    expect(checkPerformance(bytesOf(midi))).toBeUndefined()
  })

  it('rejects a file that is not MIDI at all', () => {
    const problem = checkPerformance(bytesOf(Buffer.from('NOT A MIDI FILE AT ALL')))

    expect(problem).toMatch(/could not be read as MIDI/)
    expect(problem).toMatch(/\.mid/)
  })

  it('rejects a file too short to hold a header', () => {
    expect(checkPerformance(bytesOf(Buffer.from('MThd')))).toMatch(/too short/)
  })

  it('rejects SMPTE timing, which MidiSpans divides by zero for', () => {
    // A header whose division word has its top bit set: -25 frames/second,
    // 40 ticks a frame. MidiSpans reports ticksPerBeat 0 and every onset comes
    // out Infinity.
    const smpte = Buffer.from(midi)
    smpte.writeUInt8(0xe7, 12) // -25 as a signed byte: 25 frames a second
    smpte.writeUInt8(40, 13) // 40 ticks a frame

    expect(checkPerformance(bytesOf(smpte))).toMatch(/SMPTE/)
  })

  it('accepts a real MEI', () => {
    expect(checkScore(mei)).toBeUndefined()
  })

  it('rejects an empty file', () => {
    expect(checkScore('')).toMatch(/empty/)
    expect(checkScore('   \n ')).toMatch(/empty/)
  })

  it('rejects something that is not XML', () => {
    expect(checkScore('this is not xml at all <<<>>>')).toMatch(/not valid XML/)
  })

  it('rejects XML that is not an MEI', () => {
    expect(checkScore('<html><body>a page</body></html>')).toMatch(/<html>/)
  })

  it('rejects an MEI with no notes in it', () => {
    const empty = withRepeatSigns.replace(/<note[^>]*\/>/, '<rest dur="4"/>')

    expect(checkScore(empty)).toMatch(/no notes/)
  })

  it('lets through an MEI that is well formed but musically broken', () => {
    // Whether verovio can lay it out is verovio's to say, and it says so by
    // handing back nothing rather than by failing; this check is only about not
    // giving it something absurd in the first place
    const loose = `<?xml version="1.0"?>
      <mei xmlns="http://www.music-encoding.org/ns/mei">
        <music><body><mdiv><score><note xml:id="n1" pname="c" oct="4" dur="4"/></score></mdiv></body></music>
      </mei>`

    expect(checkScore(loose)).toBeUndefined()
  })
})

describe('grace notes with nothing said about where they are written', () => {
  const graced = (extra: string) => `<?xml version="1.0"?>
    <mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score>
      <section><measure n="1"><staff n="1"><layer n="1">
        <note xml:id="g1" pname="d" oct="5" dur="8" grace="unacc"${extra}/>
        <note xml:id="n1" pname="c" oct="5" dur="4"${extra}/>
      </layer></staff></measure></section>
    </score></mdiv></body></music></mei>`

  it('is reported when the document carries no notated timing', () => {
    expect(hasUntimedGraceNotes(graced(''))).toBe(true)
  })

  it('is not reported when the document carries @dur.ppq', () => {
    expect(hasUntimedGraceNotes(graced(' dur.ppq="0"'))).toBe(false)
  })

  it('is not reported for a score with no grace notes at all', () => {
    expect(hasUntimedGraceNotes(withRepeatSigns)).toBe(false)
  })
})

describe('the order the tables reach the model in', () => {
  it('sorts the score by onset and then by pitch', () => {
    const ordered = orderScore([
      note(1, 60, 'later'),
      note(0, 64, 'high'),
      note(0, 60, 'low'),
    ])

    expect(ordered.map((row) => row.id)).toEqual(['low', 'high', 'later'])
    expect(ordered.map((row) => row.pitch)).toEqual([60, 64, 60])
  })

  it('sorts the performance the same way, in seconds', () => {
    const ordered = orderPerformance([
      span(1000, 60, 'later'),
      span(0, 64, 'high'),
      span(0, 60, 'low'),
    ])

    expect(ordered.map((row) => row.id)).toEqual(['low', 'high', 'later'])
    expect(ordered.map((row) => row.onset)).toEqual([0, 0, 1])
  })

  it('drops a note whose numbers cannot be read, and keeps the rest', () => {
    const ordered = orderScore([
      note(0, NaN, 'no-pitch'),
      { onset: Infinity, duration: 1, pitch: 60, note: 'no-onset' },
      { onset: 0, duration: NaN, pitch: 60, note: 'no-duration' },
      note(0, 60.5, 'not-a-midi-pitch'),
      note(0, 129, 'above-the-embedding'),
      note(0, -1, 'below-the-embedding'),
      note(0, 60, 'good'),
    ])

    expect(ordered.map((row) => row.id)).toEqual(['good'])
  })

  it('drops an unreadable performed note', () => {
    const broken: NoteSpan = { ...span(0, 60, 'smpte'), onsetMs: Infinity, offsetMs: Infinity }

    expect(orderPerformance([broken, span(0, 60, 'good')]).map((row) => row.id)).toEqual([
      'good',
    ])
  })
})

describe('the ids the matches come back with', () => {
  /**
   * A session that answers as the encoder would for a piece whose i-th score
   * note belongs to its i-th performed note: orthogonal directions, one per
   * note, and null logits low enough that nothing prefers them.
   */
  const diagonalSession = () => {
    const feeds: ModelFeeds[] = []
    const session: MlignSession = {
      async run(given: ModelFeeds): Promise<EncoderOutput> {
        feeds.push(given)
        const { n, m } = given
        const T = 2 + n + m
        const d = Math.max(n, m)
        const s = new Float32Array(T * d)
        const p = new Float32Array(T * d)
        for (let i = 0; i < n; i++) s[(1 + i) * d + i] = 10
        for (let j = 0; j < m; j++) p[(2 + n + j) * d + j] = 1
        return {
          n,
          m,
          T,
          s,
          p,
          matchS: new Float32Array(T).fill(-20),
          matchP: new Float32Array(T).fill(-20),
          scale: 1,
        }
      },
      hasAttribution: false,
      attrConditioned: 'none',
      async release() {},
    }
    return { session, feeds }
  }

  it('keys them by the note each row really came from', async () => {
    const { session, feeds } = diagonalSession()

    // The two files disagree about the order of a chord, which is exactly what
    // sorting by onset alone would carry into the model
    const result = await alignScoreToPerformance(
      [note(0, 64, 'score-high'), note(0, 60, 'score-low')],
      [span(0, 60, 'perf-low'), span(0, 64, 'perf-high')],
      { session }
    )

    expect(feeds).toHaveLength(1)
    // [marker, 60, 64, marker, 60, 64] — ascending inside the one onset
    expect([...feeds[0].pitch]).toEqual([128n, 60n, 64n, 128n, 60n, 64n])

    expect(
      result.matches
        .map((match) => `${match.scoreId}=${match.performanceId}`)
        .sort()
    ).toEqual(['score-high=perf-high', 'score-low=perf-low'])
  })
})
