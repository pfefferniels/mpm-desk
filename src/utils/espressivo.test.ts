import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EXAGGERATION_MAX, EXPRESSION_MAX, effectiveScalar, renderCached, type Rendered } from './espressivo'

// Zoom sets the floor and the slider spends what is left. Multiplying the two and clamping the
// product spends the slider's headroom on the zoom instead: at sketchiness 1.5 it hits the
// ceiling at exaggerate 1.27, and the top two thirds of the travel render identically.
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

describe('renderCached', () => {
    const msm = readFileSync('src/test/fixtures/score.msm', 'utf-8')
    const mpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8')

    const onsets = (rendered: Rendered) => [...rendered.noteIds.values()]

    // A curve redrawn in the editor can put one number where another as wide was, and the
    // document comes out exactly as long as it went in. The cache used to know a document by its
    // length alone, so Play went on sounding the one from before the edit.
    it('never hands two different documents of one length the same rendering', () => {
        const edited = mpm.replace('bpm="59.15049362182617"', 'bpm="99.15049362182617"')
        expect(edited).toHaveLength(mpm.length)
        expect(edited).not.toBe(mpm)

        const before = renderCached({ msm, mpm })
        const after = renderCached({ msm, mpm: edited })

        expect(after).not.toBe(before)
        expect(onsets(after)).not.toEqual(onsets(before))
        // And back again: the first document is not answered with the edit's rendering either.
        expect(onsets(renderCached({ msm, mpm }))).toEqual(onsets(before))
    })

    it('serves the same documents from the cache, however they arrived', () => {
        const first = renderCached({ msm, mpm, exaggerate: 1.5 })
        // Equal text in a different string, as a fetch or an undo would hand it over.
        const copy = [...mpm].join('')

        expect(renderCached({ msm, mpm: copy, exaggerate: 1.5 })).toBe(first)
    })
})
