import { describe, expect, it } from 'vitest'
import { quantise, type Played } from '../../../src/alignment/transcription/quantise'
import { readScore } from '../../../src/alignment/transcription/scoreModel'
import { buildTimeMap, isUnaccounted, onsetAt } from '../../../src/alignment/transcription/timeMap'
import { PLAYED, parse, scoreMei } from './fixture'

const model = readScore(parse(scoreMei()))

/** The time map of the fixture: a quarter note to the half second, every written note matched. */
const mapOf = (played: Record<string, { ms: number; pitch: number }> = PLAYED) =>
  buildTimeMap(
    Object.entries(played).flatMap(([id, { ms, pitch }]) => {
      const note = model.notes.get(id)
      return note ? [{ onset: note.event.onset, ms, pitch }] : []
    }),
  )

const played = (onsetMs: number, pitch: number, lengthMs = 200): Played => ({
  id: `p${onsetMs}`,
  onsetMs,
  offsetMs: onsetMs + lengthMs,
  pitch,
  velocity: 60,
})

const place = (notes: Played[], map = mapOf()) => quantise(model, map, notes)

describe('the time map', () => {
  it('reads between two matched moments', () => {
    expect(onsetAt(mapOf(), 750)).toBeCloseTo(1.5, 9)
    expect(onsetAt(mapOf(), 2250)).toBeCloseTo(4.5, 9)
  })

  it('has no answer outside what the recording covers', () => {
    expect(onsetAt(mapOf(), -1)).toBeUndefined()
    expect(onsetAt(mapOf(), 3001)).toBeUndefined()
  })

  it('is one anchor per written moment, with the chord spread kept', () => {
    const map = mapOf({ ...PLAYED, n3: { ms: 990, pitch: 76 }, n4: { ms: 1040, pitch: 79 }, b2: { ms: 960, pitch: 55 } })
    const third = map.anchors.find((anchor) => anchor.onset === 2)

    expect(third?.first).toBe(960)
    expect(third?.last).toBe(1040)
    expect(third?.ms).toBe(990)
    expect(third?.notes.map((note) => note.pitch)).toEqual([55, 76, 79])
  })

  it('drops an anchor the recording reaches before the one written ahead of it', () => {
    // The third quarter is written after the second and was played before it: not a tempo
    const map = mapOf({ ...PLAYED, n3: { ms: 300, pitch: 76 }, n4: { ms: 300, pitch: 79 }, b2: { ms: 300, pitch: 55 } })

    expect(map.anchors.map((anchor) => anchor.onset)).toEqual([0, 2, 4, 5, 6])
    expect(map.anchors.every((anchor, index, all) => index === 0 || anchor.ms > all[index - 1].ms)).toBe(true)
  })

  it('knows a stretch the score does not account for', () => {
    // Twelve seconds between the first bar and the second: a repeat the page shows once
    const late = Object.fromEntries(
      Object.entries(PLAYED).map(([id, entry]) => [id, entry.ms >= 2000 ? { ...entry, ms: entry.ms + 12000 } : entry]),
    )
    const map = mapOf(late)
    const gap = map.anchors.findIndex((anchor) => anchor.onset === 2)

    expect(isUnaccounted(map, gap)).toBe(true)
    expect(isUnaccounted(map, 0)).toBe(false)
    expect(place([played(7000, 60)], map)[0].placement.kind).toBe('unplaced')
  })
})

describe('placing a played note', () => {
  it('puts a note struck with a written one where that one is written', () => {
    const [entry] = place([played(1008, 60)])
    expect(entry.placement).toMatchObject({ kind: 'measured', onset: 2, coincides: true })
  })

  it('puts a note halfway between two beats on the eighth between them', () => {
    const [entry] = place([played(760, 73)])
    expect(entry.placement).toMatchObject({ kind: 'measured', onset: 1.5, level: 2, coincides: false })
  })

  it('prefers the ordinary place to the nearer one', () => {
    // 30 ms late for the eighth, and nearer a triplet eighth that nothing around it writes
    const [entry] = place([played(2280, 81)])
    expect(entry.placement).toMatchObject({ kind: 'measured', onset: 4.5 })
  })

  it('says how sure it is, and is surer of a note on a beat than of one adrift', () => {
    const [sure] = place([played(1002, 60)])
    const [unsure] = place([played(2190, 81)])

    expect(sure.confidence).toBeGreaterThan(0.8)
    expect(unsure.confidence).toBeLessThan(sure.confidence)
  })

  it('keeps a run in the order it was played in', () => {
    const run = place([played(2120, 79), played(2250, 81), played(2380, 83)])
    const onsets = run.map((entry) => (entry.placement.kind === 'measured' ? entry.placement.onset : NaN))

    expect(onsets).toEqual([...onsets].sort((a, b) => a - b))
    expect(new Set(onsets).size).toBe(3)
    expect(onsets[1]).toBe(4.5)
  })

  it('takes notes struck together for one moment', () => {
    const [entry, ...rest] = place([played(752, 73), played(770, 76)])
    expect(rest).toHaveLength(0)
    expect(entry.cluster.notes).toHaveLength(2)
  })

  it('does not place what was played before the music or after it', () => {
    expect(place([played(-900, 60)])[0].placement.kind).toBe('unplaced')
    expect(place([played(9000, 60)])[0].placement.kind).toBe('unplaced')
  })

  it('writes a grace note when asked to, and says whether one was possible', () => {
    const lean = played(2950, 76)
    const [asked] = quantise(model, mapOf(), [lean], { force: () => ({ kind: 'grace' }) })
    const [free] = place([lean])

    expect(asked.placement.kind).toBe('grace')
    expect(free.graceable).toBe(true)
    // A note a full second from anything is no grace note
    expect(place([played(1500, 60)])[0].graceable).toBe(false)
  })

  it('reads the score without the notes it is told to pretend are not there', () => {
    // Hide the second quarter and hand its played note over as though it had been added
    const hidden = new Set([model.notes.get('n2')!.event])
    const { n2, ...others } = PLAYED
    const [entry] = quantise(model, mapOf(others), [played(n2.ms, n2.pitch)], { hidden })

    expect(entry.placement).toMatchObject({ kind: 'measured', onset: 1 })
  })
})
