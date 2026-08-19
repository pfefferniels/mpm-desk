import { describe, it, expect } from 'vitest'
import { asPathD, IntensityCurve, negotiateIntensityCurve } from './intensityCurve'
import type { Motivation, Segment } from '../model/Reconstruction'

/** Helper to build an IntensityCurve from raw values (no downsampling). */
function makeCurve(values: number[]): IntensityCurve {
  return { values, step: 1, fullLength: values.length }
}

/** One segment in the middle of a 3000-tick piece. */
function pieceWith(motivation: Motivation): Segment[] {
  return [{
    id: 'a',
    motivation,
    certainty: 'plausible',
    from: 1000,
    to: 2000,
    spans: [{ id: 'tempo_1000', type: 'tempo', from: 1000, to: 2000, elements: ['tempo_1000'] }],
  }]
}

describe('negotiateIntensityCurve', () => {
  it('scales to 0..1', () => {
    // The extremes are found at full resolution, so a downsampled point can sit
    // just inside them.
    const { values } = negotiateIntensityCurve(pieceWith('intensify'), 3000)
    expect(Math.min(...values)).toBeCloseTo(0, 5)
    expect(Math.max(...values)).toBeCloseTo(1, 5)
    expect(values.every(v => v >= 0 && v <= 1)).toBe(true)
  })

  it('rises through an intensify and falls through a relax', () => {
    const rising = negotiateIntensityCurve(pieceWith('intensify'), 3000).values
    const falling = negotiateIntensityCurve(pieceWith('relax'), 3000).values
    expect(rising[1500]).toBeGreaterThan(rising[500])
    expect(falling[1500]).toBeLessThan(falling[500])
  })

  it('ignores a segment the level of detail has faded out', () => {
    const faded = negotiateIntensityCurve(pieceWith('intensify'), 3000, new Map([['a', 0]]))
    expect(faded.values.every(v => v === 0)).toBe(true)
  })
})

describe('intensityCurve utilities', () => {
  describe('asPathD', () => {
    it('returns empty string for empty input', () => {
      expect(asPathD(makeCurve([]), 100)).toBe('')
    })

    it('generates valid SVG path for single point', () => {
      const result = asPathD(makeCurve([0.5]), 100)
      expect(result).toMatch(/^M 0 \d+/)
    })

    it('generates path with correct number of points', () => {
      const values = [0, 0.5, 1, 0.5, 0]
      const result = asPathD(makeCurve(values), 100)

      // Should have M for first point, then L for each subsequent
      const moves = result.match(/M /g) || []
      const lines = result.match(/L /g) || []

      expect(moves.length).toBe(1)
      expect(lines.length).toBe(values.length - 1)
    })

    it('uses tick-space x positions (step-based, no stretchX)', () => {
      const values = [0, 1]
      const result = asPathD(makeCurve(values), 100)

      // Second point should be at x = 1 * step(=1) = 1
      expect(result).toContain('L 1')
    })

    it('maps scaled values to correct Y positions', () => {
      // scaled=0 should be at bottom, scaled=1 at top
      const padTop = 8
      const padBottom = 8
      const totalHeight = 100
      const availableHeight = totalHeight - padTop - padBottom

      // Test with value 1 (top)
      const topResult = asPathD(makeCurve([1]), totalHeight, padTop, padBottom)
      expect(topResult).toBe(`M 0 ${padTop}`)

      // Test with value 0 (bottom)
      const bottomResult = asPathD(makeCurve([0]), totalHeight, padTop, padBottom)
      expect(bottomResult).toBe(`M 0 ${padTop + availableHeight}`)
    })
  })
})
