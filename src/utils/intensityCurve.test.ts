import { describe, it, expect } from 'vitest'
import { asPathD, IntensityCurve } from './intensityCurve'

/** Helper to build an IntensityCurve from raw values (no downsampling). */
function makeCurve(values: number[]): IntensityCurve {
  return { values, step: 1, fullLength: values.length }
}

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
