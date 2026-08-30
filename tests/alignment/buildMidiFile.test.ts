import { describe, it, expect } from 'vitest'
import type { AnyEvent } from 'midifile-ts'
import {
  midiFileOf,
  type PlayableNote,
  type PlayablePedal,
} from '../../src/performance/buildMidiFile'

const note = (id: string, onsetMs: number, offsetMs: number, pitch = 60): PlayableNote => ({
  id,
  pitch,
  onsetMs,
  offsetMs,
  velocity: 64,
})

/** The events back in absolute time, which is how they were asked for. */
function absolute(file: ReturnType<typeof midiFileOf>): { at: number; event: AnyEvent }[] {
  let now = 0
  return file.tracks[0].map((event) => {
    now += event.deltaTime
    return { at: now, event }
  })
}

const onsetsOf = (file: ReturnType<typeof midiFileOf>) =>
  absolute(file)
    .filter(({ event }) => event.type === 'meta' && event.subtype === 'text')
    .map(({ at, event }) => [(event as AnyEvent & { text: string }).text, at] as const)

const notes = [note('a', 0, 500), note('b', 1000, 1500), note('c', 2000, 2500)]

describe('a performance as MIDI', () => {
  it('plays the whole thing when no stretch is asked for', () => {
    expect(onsetsOf(midiFileOf(notes))).toEqual([
      ['a', 0],
      ['b', 1000],
      ['c', 2000],
    ])
  })

  it('plays only the notes struck inside the stretch asked for', () => {
    const played = onsetsOf(midiFileOf(notes, [], { fromMs: 900, toMs: 1600 }))

    expect(played.map(([id]) => id)).toEqual(['b'])
  })

  it('rebases the stretch to its own start, so the passage begins at once', () => {
    const played = onsetsOf(midiFileOf(notes, [], { fromMs: 1000, toMs: 3000 }))

    expect(played).toEqual([
      ['b', 0],
      ['c', 1000],
    ])
  })

  // Cutting the note off at the boundary would be an artefact of the listening
  it('lets a note struck near the end ring on past it', () => {
    const file = midiFileOf([note('a', 900, 4000)], [], { fromMs: 800, toMs: 1000 })
    const off = absolute(file).find(
      ({ event }) => event.type === 'channel' && event.subtype === 'noteOff'
    )

    expect(off?.at).toBe(3200)
  })

  it('presses a pedal that was already down when the stretch begins', () => {
    const pedal: PlayablePedal = { type: 'sustain', onsetMs: 200, durationMs: 3000 }
    const file = midiFileOf(notes, [pedal], { fromMs: 1000, toMs: 2000 })
    const moves = absolute(file).filter(
      ({ event }) => event.type === 'channel' && event.subtype === 'controller'
    )

    expect(moves.map(({ at }) => at)).toEqual([0, 2200])
  })

  it('leaves out a pedal that had been lifted before the stretch begins', () => {
    const pedal: PlayablePedal = { type: 'sustain', onsetMs: 0, durationMs: 100 }
    const file = midiFileOf(notes, [pedal], { fromMs: 1000, toMs: 2000 })

    expect(
      absolute(file).some(
        ({ event }) => event.type === 'channel' && event.subtype === 'controller'
      )
    ).toBe(false)
  })

  it('ends the track after the last sound, whatever the stretch was', () => {
    const file = midiFileOf(notes, [], { fromMs: 1000, toMs: 1200 })
    const end = absolute(file).find(
      ({ event }) => event.type === 'meta' && event.subtype === 'endOfTrack'
    )

    expect(end?.at).toBe(501)
  })
})
