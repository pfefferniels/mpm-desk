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
import { read, type AnyEvent, type MidiFile } from 'midifile-ts'
import { asSpans, type NoteSpan, type PedalSpan } from '../../src/performance/midiSpans'

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

/** A track of controller steps and labels at 480 ppq, 120 bpm: a tick is 1/0.96 ms. */
const controllerTrack = (steps: readonly (readonly [deltaTime: number, value: number] | readonly [deltaTime: number, label: string])[]): MidiFile => ({
  header: { formatType: 0, trackCount: 1, ticksPerBeat: 480 },
  tracks: [
    [
      ...steps.map(([deltaTime, step]): AnyEvent =>
        typeof step === 'string'
          ? ({ deltaTime, type: 'meta', subtype: 'text', text: step } as AnyEvent)
          : ({ deltaTime, type: 'channel', subtype: 'controller', channel: 0, controllerType: 64, value: step } as AnyEvent)),
      { deltaTime: 0, type: 'meta', subtype: 'endOfTrack' } as AnyEvent,
    ],
  ],
} as MidiFile)

/** One step per unit level, the way linked-rolls writes a traversal: the label on the first step. */
const traversal = (label: string, deltaTime: number, from: number, to: number): (readonly [number, number] | readonly [number, string])[] => {
  const levels = Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + Math.sign(to - from) * i)
  return levels.flatMap((value, i): (readonly [number, number] | readonly [number, string])[] =>
    i === 0 ? [[deltaTime, label], [0, value]] : [[1, value]])
}

const pedalsOf = (file: MidiFile) =>
  asSpans(file, true).filter((span): span is PedalSpan => span.type !== 'note')

describe('reading a pedal off a controller stream', () => {
  it('reads a switch as one press with a two-vertex travel', () => {
    const [press] = pedalsOf(controllerTrack([[0, 0], [1000, 'on'], [0, 127], [960, 'off'], [0, 0]]))

    expect(press.onset).toBe(1000)
    expect(press.offset).toBe(1960)
    expect(press.travel.map((vertex) => vertex.position)).toEqual([1, 0])
    expect(press.travel[0].ms).toBe(0)
    expect(press.travel[1].ms).toBeCloseTo(1000, 6)
    expect(press.link).toBe('on off')
  })

  it('reads a continuous controller as one press from leaving rest to returning there', () => {
    const [press] = pedalsOf(controllerTrack([
      [0, 0],
      ...traversal('on', 1000, 1, 127),
      ...traversal('off', 800, 126, 0),
    ]))

    expect(press.onset).toBe(1000)
    expect(press.offset).toBe(1000 + 126 + 800 + 126)
    expect(press.travel).toHaveLength(127 + 127)
    expect(press.travel[0]).toEqual({ ms: 0, position: 1 / 127 })
    expect(press.travel.at(-1)?.position).toBe(0)
    expect(press.travel.at(-1)?.ms).toBeCloseTo(press.offsetMs - press.onsetMs, 6)
  })

  // The label sits on the first step after the perforation, which is not where the line crosses
  // the middle: a reader that only looked at the crossing would find no label there
  it('gives the press the labels of both perforations, however many steps lie between', () => {
    const [press] = pedalsOf(controllerTrack([
      [0, 0],
      ...traversal('on', 1000, 1, 127),
      ...traversal('off', 800, 126, 0),
    ]))

    expect(press.link).toBe('on off')
  })

  it('keeps a lift that turns back before reaching rest inside the one press', () => {
    const [press, ...rest] = pedalsOf(controllerTrack([
      [0, 0],
      ...traversal('on', 1000, 1, 127),
      ...traversal('half', 500, 126, 40),
      ...traversal('retake', 0, 41, 127),
      ...traversal('off', 800, 126, 0),
    ]))

    expect(rest).toHaveLength(0)
    const dips = press.travel.filter(
      (vertex, i, all) =>
        i > 0 && i < all.length - 1 && vertex.position < all[i - 1].position && vertex.position < all[i + 1].position,
    )
    expect(dips).toHaveLength(1)
    expect(dips[0].position).toBe(40 / 127)
  })

  it('ignores a value at rest while no press is open', () => {
    expect(pedalsOf(controllerTrack([[0, 0], [100, 0], [100, 0]]))).toHaveLength(0)
  })

  it('finds every press of the roll, which is a switch', () => {
    const values = roll.tracks
      .flat()
      .filter((event) => event.type === 'channel' && event.subtype === 'controller' && event.controllerType === 64)
      .map((event) => (event as AnyEvent & { value: number }).value)
    const releases = values.filter((value, i) => i > 0 && value === 0 && values[i - 1] > 0).length

    const sustain = asSpans(roll).filter((span): span is PedalSpan => span.type === 'sustain')
    expect(sustain).toHaveLength(releases)
    // Down at once and up at the end; the roll presses two of them twice, which adds a vertex
    for (const span of sustain) {
      expect(span.travel[0]).toEqual({ ms: 0, position: 1 })
      expect(span.travel.at(-1)?.position).toBe(0)
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
