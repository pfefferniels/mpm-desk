// @vitest-environment node
//
// Node's realm, not jsdom's. `read` checks its argument with `instanceof ArrayBuffer`, and under
// jsdom that names jsdom's `ArrayBuffer` — so the buffer sliced out of a Node `Buffer` below is
// an object of some other kind and the parser refuses it outright. aligned-mei set no global
// environment and so got node here by default; mpm-desk's is jsdom, which is why it has to be
// said.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { read, type MidiFile } from 'midifile-ts'
import { asSpans, type NoteSpan } from '../../src/performance/midiSpans'

/** A Welte reproducing roll, which accelerates throughout: 29 tempo changes */
const bytes = readFileSync(join(__dirname, 'welte-red_midi-exp_wv912mm2332_exp(1).mid'))
// Node hands out buffers that are views into a shared pool, so the file has to be
// cut out of it before it can be read as an ArrayBuffer of its own
const roll = read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

/** The same integration, written independently of the implementation */
function millisecondsAt(file: MidiFile, ticks: number): number {
  const tempos: { tick: number; usPerBeat: number }[] = []
  for (const track of file.tracks) {
    let tick = 0
    for (const event of track) {
      tick += event.deltaTime
      if (event.type === 'meta' && event.subtype === 'setTempo') {
        tempos.push({ tick, usPerBeat: event.microsecondsPerBeat })
      }
    }
  }
  tempos.sort((a, b) => a.tick - b.tick)

  let ms = 0
  let from = 0
  let usPerBeat = tempos[0]?.usPerBeat ?? 500000
  for (const tempo of tempos) {
    if (tempo.tick >= ticks) break
    ms += ((tempo.tick - from) / file.header.ticksPerBeat) * usPerBeat / 1000
    from = tempo.tick
    usPerBeat = tempo.usPerBeat
  }
  return ms + ((ticks - from) / file.header.ticksPerBeat) * usPerBeat / 1000
}

let notes: NoteSpan[]

beforeAll(() => {
  notes = asSpans(roll, true).filter((span): span is NoteSpan => span.type === 'note')
})

describe('timing a performance whose tempo moves', () => {
  it('reads the roll', () => {
    expect(notes.length).toBeGreaterThan(400)
  })

  it('integrates the tempo map rather than scaling by the tempo in force', () => {
    // Applying the current tempo to the whole elapsed tick count instead drifts by
    // seconds on this roll, and the drift grows as the roll accelerates
    for (const note of notes) {
      expect(note.onsetMs).toBeCloseTo(millisecondsAt(roll, note.onset), 6)
      expect(note.offsetMs).toBeCloseTo(millisecondsAt(roll, note.offset), 6)
    }
  })

  it('never lets performed time run backwards', () => {
    const inOrder = [...notes].sort((a, b) => a.onset - b.onset)

    for (let i = 1; i < inOrder.length; i++) {
      expect(inOrder[i].onsetMs).toBeGreaterThanOrEqual(inOrder[i - 1].onsetMs)
    }
  })

  it('gives every note a positive duration', () => {
    for (const note of notes) {
      expect(note.offsetMs).toBeGreaterThan(note.onsetMs)
    }
  })
})

describe('timing a performance that states no tempo', () => {
  it('falls back to 120 bpm instead of dropping every note', () => {
    const file: MidiFile = {
      header: { formatType: 0, trackCount: 1, ticksPerBeat: 480 },
      tracks: [
        [
          { deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 0, noteNumber: 60, velocity: 64 },
          { deltaTime: 480, type: 'channel', subtype: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
          { deltaTime: 0, type: 'meta', subtype: 'endOfTrack' },
        ],
      ],
    } as unknown as MidiFile

    const [note] = asSpans(file)

    expect(note).toBeDefined()
    expect(note.onsetMs).toBe(0)
    // One beat at 120 bpm
    expect(note.offsetMs).toBe(500)
  })
})
