import { describe, it, expect } from 'vitest'
import { asPathD } from './intensityCurve'

describe('intensityCurve utilities', () => {
  describe('asPathD', () => {
    it('returns empty string for empty input', () => {
      expect(asPathD([], 1, 100)).toBe('')
    })

    it('generates valid SVG path for single point', () => {
      const result = asPathD([0.5], 10, 100)
      expect(result).toMatch(/^M 0 \d+/)
    })

    it('generates path with correct number of points', () => {
      const values = [0, 0.5, 1, 0.5, 0]
      const result = asPathD(values, 10, 100)

      // Should have M for first point, then L for each subsequent
      const moves = result.match(/M /g) || []
      const lines = result.match(/L /g) || []

      expect(moves.length).toBe(1)
      expect(lines.length).toBe(values.length - 1)
    })

    it('respects stretchX parameter', () => {
      const values = [0, 1]
      const stretchX = 20
      const result = asPathD(values, stretchX, 100)

      // Second point should be at x = stretchX
      expect(result).toContain(`L ${stretchX}`)
    })

    it('maps scaled values to correct Y positions', () => {
      // scaled=0 should be at bottom, scaled=1 at top
      const padTop = 8
      const padBottom = 8
      const totalHeight = 100
      const availableHeight = totalHeight - padTop - padBottom

      // Test with value 1 (top)
      const topResult = asPathD([1], 10, totalHeight, padTop, padBottom)
      expect(topResult).toBe(`M 0 ${padTop}`)

      // Test with value 0 (bottom)
      const bottomResult = asPathD([0], 10, totalHeight, padTop, padBottom)
      expect(bottomResult).toBe(`M 0 ${padTop + availableHeight}`)
    })
  })
})
