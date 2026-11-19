// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import type { VerovioToolkit } from 'verovio/esm'
import { loadVerovio, renderScore } from '../../src/verovio/toolkit'
import { drawExtraNotes, timelineOf, type ExtraNote } from '../../src/verovio/extraNotes'
import { PLAYED, scoreMei } from './transcription/fixture'

/**
 * The played notes with no note in the score, on a score laid out the ordinary way.
 *
 * There is no time axis to measure along, so a played note goes between the two written notes it
 * was played between, as far along as it was in time. The fixture is two bars of C major, a
 * quarter every half second, with a chord at one second.
 */
describe('where a moment falls between the notes around it', () => {
  const space = 10

  it('falls in proportion between the two places it lies between', () => {
    const xAt = timelineOf([{ x: 100, onsetMs: 0 }, { x: 200, onsetMs: 500 }, { x: 260, onsetMs: 1000 }], space)

    expect(xAt(250)).toBeCloseTo(150)
    expect(xAt(750)).toBeCloseTo(230)
  })

  it('takes a spread chord to stand where the middle of its notes was struck', () => {
    const xAt = timelineOf(
      [
        { x: 100, onsetMs: 0 },
        { x: 200, onsetMs: 900 },
        { x: 200, onsetMs: 1000 },
        { x: 200, onsetMs: 1300 },
        { x: 300, onsetMs: 2000 },
      ],
      space,
    )

    expect(xAt(1000)).toBeCloseTo(200)
    expect(xAt(1500)).toBeCloseTo(250)
  })

  it('leaves out a place struck before the one before it, so that time never runs backwards', () => {
    const xAt = timelineOf([{ x: 100, onsetMs: 0 }, { x: 150, onsetMs: 1500 }, { x: 200, onsetMs: 1000 }], space)

    // Read between 0 at 100 and 1500 at 150, the place struck at 1000 being dropped
    expect(xAt(750)).toBeCloseTo(125)
  })

  it('goes on at the nearest pace beyond the notes, but no further than the music on the system', () => {
    const xAt = timelineOf([{ x: 100, onsetMs: 1000 }, { x: 200, onsetMs: 2000 }], space)

    expect(xAt(2100)).toBeCloseTo(210)
    expect(xAt(9000)).toBeCloseTo(220)
    expect(xAt(0)).toBeCloseTo(80)
  })
})

describe('a played note on a score laid out the ordinary way', () => {
  let root: HTMLDivElement
  const xOf = (id: string) =>
    Number(
      root
        .querySelector(`[data-id="${id}"] .notehead use`)
        ?.getAttribute('transform')
        ?.match(/translate\(\s*([-0-9.]+)/)?.[1],
    )
  const crossAt = () => {
    const d = root.querySelector('.performanceExtraNote path')?.getAttribute('d')
    const arms = d?.match(/^M([-0-9.]+) [-0-9.]+ L([-0-9.]+)/)
    return arms ? (Number(arms[1]) + Number(arms[2])) / 2 : undefined
  }
  const played = (onsetMs: number, pitch: number): ExtraNote => ({
    id: 'x1',
    divergenceId: 'added-x1',
    onsetMs,
    offsetMs: onsetMs + 200,
    pitch,
    resolved: true,
  })

  beforeAll(async () => {
    const toolkit: VerovioToolkit = await loadVerovio()
    root = document.createElement('div')
    root.innerHTML = renderScore(toolkit, scoreMei()).join('')
    document.body.appendChild(root)
  }, 60_000)

  const struck = new Map(Object.entries(PLAYED).map(([id, { ms }]) => [id, ms]))

  it('has no time to read off the drawing', () => {
    expect(root.querySelector('[data-perf-onset]')).toBeNull()
  })

  it('stands half way between the notes it was played half way between', () => {
    drawExtraNotes(root, [played(750, 74)], { tonic: 'C', struck })

    // d5 at 750 ms: half way between the d5 at 500 and the chord at 1000
    expect(crossAt()).toBeCloseTo((xOf('n2') + xOf('n3')) / 2, 0)
  })

  it('goes on the staff its pitch belongs on, even where only the other staff has anchors', () => {
    const bassOnly = new Map([...struck].filter(([id]) => id.startsWith('b')))
    drawExtraNotes(root, [played(750, 74)], { tonic: 'C', struck: bassOnly })

    const cross = root.querySelector('.performanceExtraNote')
    expect(cross?.closest('.staff')?.getAttribute('data-n')).toBe('1')
  })

  it('is placed by the notes it is given and no others', () => {
    // Without the d5 among the anchors, 750 ms is three quarters of the way from 0 to 1000
    const without = new Map([...struck].filter(([id]) => id !== 'n2'))
    drawExtraNotes(root, [played(750, 74)], { tonic: 'C', struck: without })

    expect(crossAt()).toBeCloseTo(xOf('n1') + 0.75 * (xOf('n3') - xOf('n1')), 0)
  })
})
