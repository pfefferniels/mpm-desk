import { describe, expect, it } from 'vitest'
import { EXAGGERATION_MAX, EXPRESSION_MAX, effectiveScalar } from './espressivo'

// The slider used to be multiplied with the zoom-derived sketchiness and the product clamped, which
// spent the slider's headroom on the zoom: at sketchiness 1.5 the product hit the ceiling at
// exaggerate 1.27 and the top two thirds of the travel rendered identically. Zoom sets the floor
// now, and the slider spends what is left.
describe('effectiveScalar', () => {
    it('is neutral at the bottom of the slider with no sketchiness', () => {
        expect(effectiveScalar(1, 1)).toBe(1)
    })

    it('reaches the ceiling at the top of the slider, at every zoom', () => {
        for (const sketchiness of [1, 1.1, 1.25, 1.4, 1.5]) {
            expect(effectiveScalar(EXAGGERATION_MAX, sketchiness)).toBeCloseTo(EXPRESSION_MAX, 10)
        }
    })

    it('never exceeds the ceiling', () => {
        for (const sketchiness of [1, 1.25, 1.5, 3]) {
            for (let v = 1; v <= EXAGGERATION_MAX; v += 0.01) {
                expect(effectiveScalar(v, sketchiness)).toBeLessThanOrEqual(EXPRESSION_MAX + 1e-9)
            }
        }
    })

    it('leaves no dead zone: every slider step moves the scalar, at every zoom', () => {
        for (const sketchiness of [1, 1.25, 1.4, 1.5]) {
            let previous = effectiveScalar(1, sketchiness)
            for (let v = 1.01; v <= EXAGGERATION_MAX + 1e-9; v += 0.01) {
                const scalar = effectiveScalar(v, sketchiness)
                expect(scalar).toBeGreaterThan(previous)
                previous = scalar
            }
        }
    })

    it('keeps the floor the zoom used to impose', () => {
        // sketchiness alone, with the slider at rest, is what it always was
        expect(effectiveScalar(1, 1.405)).toBeCloseTo(1.405, 10)
        expect(effectiveScalar(1, 1.5)).toBeCloseTo(1.5, 10)
    })

    it('is monotone in sketchiness too', () => {
        for (const v of [1, 1.3, 1.7, 2]) {
            let previous = effectiveScalar(v, 1)
            for (let k = 1.05; k <= 1.5; k += 0.05) {
                const scalar = effectiveScalar(v, k)
                expect(scalar).toBeGreaterThanOrEqual(previous - 1e-9)
                previous = scalar
            }
        }
    })

    it('treats an omitted knob as neutral', () => {
        expect(effectiveScalar()).toBe(1)
        expect(effectiveScalar(1.5)).toBeCloseTo(effectiveScalar(1.5, 1), 10)
    })
})
