// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { loadVerovio, renderPerformance, unitsPerSecond } from '../../src/verovio/toolkit'
import { clearExtraNotes, drawExtraNotes, type ExtraNote } from '../../src/verovio/extraNotes'
import type { VerovioToolkit } from 'verovio/esm'

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')

/** One rendered note to measure against: its time, its pitch, its notehead. */
interface Drawn {
  id: string
  onsetMs: number
  pname: string
  oct: number
  x: number
  y: number
}

let root: HTMLDivElement
let drawn: Drawn[]

beforeAll(async () => {
  const tk: VerovioToolkit = await loadVerovio()
  const pages = renderPerformance(tk, mei, { performanceRecording: '1' })

  root = document.createElement('div')
  root.innerHTML = pages.join('')
  document.body.appendChild(root)

  drawn = []
  for (const note of root.querySelectorAll('.note')) {
    const onset = note.getAttribute('data-perf-onset')
    const pname = note.getAttribute('data-pname')
    const oct = note.getAttribute('data-oct')
    const t = note
      .querySelector('.notehead use')
      ?.getAttribute('transform')
      ?.match(/translate\(\s*([-0-9.]+)[\s,]+([-0-9.]+)/)
    if (!onset || !pname || !oct || !t) continue

    drawn.push({
      id: note.getAttribute('data-id') ?? '',
      onsetMs: Number(onset),
      pname,
      oct: Number(oct),
      x: Number(t[1]),
      y: Number(t[2]),
    })
  }
}, 60_000)

const extra = (onsetMs: number, pitch: number): ExtraNote => ({
  id: 'x1',
  divergenceId: 'added-0',
  onsetMs,
  offsetMs: onsetMs + 100,
  pitch,
  resolved: false,
})

/** Where the cross for a given note ended up. */
const crossAt = () => {
  const group = root.querySelector('.performanceExtraNote')
  const d = group?.querySelector('path')?.getAttribute('d')
  const first = d?.match(/^M([-0-9.]+) ([-0-9.]+)/)
  if (!first) return undefined

  // The path starts at the top-left arm, so the centre is half an arm in
  const armX = Number(first[1])
  const armY = Number(first[2])
  const second = d!.match(/L([-0-9.]+) ([-0-9.]+)/)!
  return { x: (armX + Number(second[1])) / 2, y: (armY + Number(second[2])) / 2 }
}

/** The MIDI pitch of a rendered note, for placing a cross exactly on top of it. */
const midiOf = (note: Drawn) => {
  const steps: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
  return (note.oct + 1) * 12 + steps[note.pname.toLowerCase()]
}

describe('drawing the played notes that have no note in the score', () => {
  it('renders a score that carries the times and pitches to measure from', () => {
    expect(drawn.length).toBeGreaterThan(10)
  })

  /**
   * The self-checking property: a note played at the same moment and pitch as one
   * verovio has drawn belongs in the very same place. If the time-to-x or the
   * pitch-to-y conversion were wrong, this is what would show it.
   */
  it('puts a cross exactly where the score already has that note', () => {
    const target = drawn.find((note) => note.pname && Number.isFinite(note.onsetMs))!
    clearExtraNotes(root)
    drawExtraNotes(root, [extra(target.onsetMs, midiOf(target))], { tonic: 'C' })

    const at = crossAt()
    expect(at).toBeDefined()
    expect(at!.x).toBeCloseTo(target.x, 0)
    expect(at!.y).toBeCloseTo(target.y, 0)
  })

  it('moves it to the right by one second’s worth of units per second played later', () => {
    const target = drawn[0]
    const perSecond = unitsPerSecond({})

    clearExtraNotes(root)
    drawExtraNotes(root, [extra(target.onsetMs, midiOf(target))], { tonic: 'C' })
    const at = crossAt()!

    clearExtraNotes(root)
    drawExtraNotes(root, [extra(target.onsetMs + 1000, midiOf(target))], { tonic: 'C' })
    const later = crossAt()!

    // Not exact to the unit: a note played a second later may be measured from a
    // different note of the score, and verovio rounds each one's performed onset
    // to whole milliseconds. A unit or two on fourteen hundred is that rounding
    expect(Math.abs(later.x - at.x - perSecond)).toBeLessThan(2)
  })

  it('puts a note an octave higher seven half-spaces above', () => {
    const target = drawn[0]

    clearExtraNotes(root)
    drawExtraNotes(root, [extra(target.onsetMs, midiOf(target))], { tonic: 'C' })
    const at = crossAt()!

    clearExtraNotes(root)
    drawExtraNotes(root, [extra(target.onsetMs, midiOf(target) + 12)], { tonic: 'C' })
    const higher = crossAt()!

    // Up the page is a smaller y, and an octave is seven diatonic steps
    expect(higher.y).toBeLessThan(at.y)
    expect(at.y - higher.y).toBeCloseTo((7 * (9 * 20)) / 2, 0)
  })

  it('carries the divergence it belongs to, so a click can find it', () => {
    clearExtraNotes(root)
    drawExtraNotes(root, [extra(drawn[0].onsetMs, midiOf(drawn[0]))], { tonic: 'C' })

    expect(
      root.querySelector('.performanceExtraNote')?.getAttribute('data-divergence')
    ).toBe('added-0')
  })

  it('clears what it drew before, so redrawing does not pile crosses up', () => {
    clearExtraNotes(root)
    drawExtraNotes(root, [extra(drawn[0].onsetMs, midiOf(drawn[0]))], { tonic: 'C' })
    drawExtraNotes(root, [extra(drawn[0].onsetMs, midiOf(drawn[0]))], { tonic: 'C' })

    expect(root.querySelectorAll('.performanceExtraNote')).toHaveLength(1)

    clearExtraNotes(root)
    expect(root.querySelectorAll('.performanceExtraNote')).toHaveLength(0)
  })

  it('draws nothing at all when there is nothing to draw', () => {
    clearExtraNotes(root)
    drawExtraNotes(root, [], {})

    expect(root.querySelectorAll('.performanceExtraNote')).toHaveLength(0)
  })
})
