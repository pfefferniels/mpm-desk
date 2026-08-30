import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { sumF32, interp, uniqueWithIndex, monotoneSubset, firstArgmax } from '../../src/alignment/mlign/decode'

/**
 * NumPy-parity tests for the decode's numeric primitives.
 *
 * The golden pieces pin the decode end to end, but real repertoire never
 * reaches some of the behaviour the port relies on: no argmax tie occurs in any
 * of them, no score onset falls outside the interpolated time map, and the
 * summation order never changes an outcome. Those choices were made by reading
 * the NumPy source, and without a test they would stay assumptions — correct
 * today, quietly wrong the first time a piece does reach them.
 *
 * The oracle values in `numpy-primitives.json` come straight from NumPy (and,
 * for the longest-chain case, from the reference `_monotone_subset` itself).
 */

interface Oracle {
    numpy_version: string
    interp: {
        name: string
        x: number[]
        xp: number[]
        fp: number[]
        want: number[]
        want_unfused: number[]
        fma_differs: boolean[]
    }[]
    sum_f32: { n: number; a: number[]; want: number; naive_differs: boolean; f64_differs: boolean }[]
    unique: { name: string; values: number[]; want_values: number[]; want_index: number[] }[]
    monotone_subset: {
        name: string
        anchors: number[][]
        s_onset: number[]
        p_onset: number[]
        want: number[][]
    }[]
    argmax: { matrix: number[][]; want_axis1: number[]; want_axis0: number[] }
}

const oracle: Oracle = JSON.parse(
    readFileSync(join(__dirname, 'golden', 'numpy-primitives.json'), 'utf-8')
)

describe('np.interp', () => {
    for (const c of oracle.interp) {
        it(`matches NumPy's arithmetic exactly: ${c.name}`, () => {
            // Held bit-for-bit against a transcription of NumPy's `arr_interp`
            // evaluated in plain IEEE doubles. NumPy's own output is compared
            // separately, because on this platform its C compiler contracts the
            // slope expression into an FMA that JS has no way to reproduce.
            const xp = Float64Array.from(c.xp)
            const fp = Float64Array.from(c.fp)
            const got = c.x.map((x) => interp(x, xp, fp))
            expect(got).toEqual(c.want_unfused)
        })
    }

    it('differs from NumPy only where NumPy fused a multiply-add', () => {
        let differing = 0
        let worstRel = 0
        for (const c of oracle.interp) {
            const xp = Float64Array.from(c.xp)
            const fp = Float64Array.from(c.fp)
            c.x.forEach((x, i) => {
                const got = interp(x, xp, fp)
                if (got !== c.want[i]) {
                    differing++
                    // Only ever on a point NumPy itself computed differently
                    // from unfused arithmetic — never a semantic disagreement.
                    expect(c.fma_differs[i], `${c.name} x=${x} is not an FMA case`).toBe(true)
                    worstRel = Math.max(worstRel, Math.abs(got - c.want[i]) / Math.abs(c.want[i]))
                }
            })
        }
        // A handful of ULP, i.e. ~1e-15 seconds against a 1 s tolerance.
        expect(worstRel).toBeLessThan(1e-14)
        expect(differing).toBeLessThanOrEqual(oracle.interp.reduce((a, c) => a + c.fma_differs.filter(Boolean).length, 0))
    })

    it('is bit-exact wherever the decode branches on the value', () => {
        // Clamping, exact knot hits and the single-point fallback are decisions,
        // not arithmetic — an off-by-one-ULP there would be an off-by-one note.
        const xp = Float64Array.from([0.0, 1.0, 2.0, 3.0])
        const fp = Float64Array.from([5.0, 6.0, 8.0, 9.0])
        expect(interp(-10, xp, fp)).toBe(5.0)
        expect(interp(99, xp, fp)).toBe(9.0)
        for (let k = 0; k < xp.length; k++) expect(interp(xp[k], xp, fp)).toBe(fp[k])

        const one = Float64Array.from([2.0])
        const oneF = Float64Array.from([7.0])
        for (const x of [-1, 2, 5]) expect(interp(x, one, oneF)).toBe(7.0)

        // Every fixture case that is a clamp or an exact hit, checked exactly.
        for (const c of oracle.interp) {
            const cxp = Float64Array.from(c.xp)
            const cfp = Float64Array.from(c.fp)
            c.x.forEach((x, i) => {
                const structural =
                    cxp.length === 1 || x <= cxp[0] || x >= cxp[cxp.length - 1] || c.xp.includes(x)
                if (structural) expect(interp(x, cxp, cfp), `${c.name} x=${x}`).toBe(c.want[i])
            })
        }
    })
})

describe('float32 reduction order', () => {
    it('reproduces NumPy pairwise summation bit-for-bit', () => {
        const discriminating = oracle.sum_f32.filter((c) => c.naive_differs || c.f64_differs)
        // If this ever drops to zero the suite has stopped testing anything.
        expect(discriminating.length).toBeGreaterThan(5)
        for (const c of oracle.sum_f32) {
            const a = Float32Array.from(c.a)
            expect(sumF32(a, 0, a.length), `n=${c.n}`).toBe(c.want)
        }
    })

    it('differs from a naive running total, which is why the order is kept', () => {
        const c = oracle.sum_f32.find((x) => x.naive_differs)!
        const a = Float32Array.from(c.a)
        let naive = 0
        for (let i = 0; i < a.length; i++) naive = Math.fround(naive + a[i])
        expect(naive).not.toBe(c.want)
        expect(sumF32(a, 0, a.length)).toBe(c.want)
    })
})

describe('np.unique(return_index=True)', () => {
    for (const c of oracle.unique) {
        it(`matches NumPy: ${c.name}`, () => {
            const got = uniqueWithIndex(Float64Array.from(c.values))
            expect(Array.from(got.values)).toEqual(c.want_values)
            expect(Array.from(got.index)).toEqual(c.want_index)
        })
    }
})

describe('_monotone_subset', () => {
    for (const c of oracle.monotone_subset) {
        it(`matches the reference: ${c.name}`, () => {
            const got = monotoneSubset(
                c.anchors.map((a) => [a[0], a[1]] as [number, number]),
                Float64Array.from(c.s_onset),
                Float64Array.from(c.p_onset)
            )
            expect(got.map((p) => [p[0], p[1]])).toEqual(c.want)
        })
    }
})

describe('argmax tie-breaking', () => {
    // This is the function the decode itself calls, not a restatement of it.
    const rows = oracle.argmax.matrix
    const n = rows.length
    const m = rows[0].length
    const flat = Float32Array.from(rows.flat())

    it('returns the first maximum along rows, as NumPy does', () => {
        const got = Array.from({ length: n }, (_, i) => firstArgmax(flat, i * m, 1, m))
        expect(got).toEqual(oracle.argmax.want_axis1)
    })

    it('returns the first maximum along columns, as NumPy does', () => {
        const got = Array.from({ length: m }, (_, j) => firstArgmax(flat, j, m, n))
        expect(got).toEqual(oracle.argmax.want_axis0)
    })

    it('picks index 0 when every value ties, as an uncovered row does', () => {
        const zeros = new Float32Array(8)
        expect(firstArgmax(zeros, 0, 1, 8)).toBe(0)
    })
})
