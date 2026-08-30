import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { decodeTraced, dualSoftmax } from '../../src/alignment/mlign/decode'
import type { MlignRow, SimBundle, ScoreRow, PerfRow } from '../../src/alignment/mlign/types'

/**
 * Golden-fixture parity for the decode port.
 *
 * Each fixture carries the model's raw output (`sim`, `null_s`, `null_p`), the
 * dual-softmax confidence the Python computed from it, every decode stage in
 * between, and the triples that came out. Checking the stages rather than only
 * the triples is what makes a failure diagnosable: a wrong DTW tie and a wrong
 * assignment DP both end as "some notes moved", but they diverge at different
 * stages.
 */

const LOCAL_GOLDEN = join(__dirname, 'golden')
/** See `mlign-featurize.test.ts`: unset, the fixtures it names skip. */
const MLIGN_GOLDEN = process.env.MLIGN_GOLDEN

interface Manifest {
    meta: { n: number; m: number; windowed: boolean; constants: Record<string, number> }
    row: { score: ScoreRow[]; perf: PerfRow[] }
    stages: {
        anchors_raw: [number, number][]
        anchors: [number, number][]
        dtw_ax: number[]
        dtw_ay: number[]
        map1_ax: number[]
        map1_ay: number[]
        map2_ax: number[]
        map2_ay: number[]
        rounds_run: number
        round1_matched_s: number[]
        round2_matched_s: number[]
        rescued: [number, number][]
    }
    triples: { label: string; score_idx?: number; perf_idx?: number; confidence: number }[]
}

function readF32(path: string): Float32Array {
    const b = readFileSync(path)
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

function loadFixture(dir: string) {
    const manifest: Manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    const { n, m } = manifest.meta
    const bundle: SimBundle = {
        n,
        m,
        sim: readF32(join(dir, 'sim.f32.bin')),
        nullS: readF32(join(dir, 'null_s.f32.bin')),
        nullP: readF32(join(dir, 'null_p.f32.bin')),
    }
    const row: MlignRow = { score: manifest.row.score, perf: manifest.row.perf }
    return { manifest, bundle, row, conf: readF32(join(dir, 'conf.f32.bin')) }
}

/** Largest absolute gap between two same-length numeric sequences. */
function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let worst = 0
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i])
        if (d > worst) worst = d
    }
    return worst
}

function pairsEqual(got: readonly (readonly [number, number])[], want: [number, number][]) {
    expect(got.length).toBe(want.length)
    const bad: string[] = []
    for (let i = 0; i < want.length && bad.length < 5; i++) {
        if (got[i][0] !== want[i][0] || got[i][1] !== want[i][1]) {
            bad.push(`[${i}] got (${got[i][0]},${got[i][1]}) want (${want[i][0]},${want[i][1]})`)
        }
    }
    expect(bad).toEqual([])
}

function checkFixture(dir: string) {
    const { manifest, bundle, row, conf: goldConf } = loadFixture(dir)
    const { n, m } = manifest.meta
    const st = manifest.stages

    // Stage 0: the dual softmax, in isolation. JS has no float32 `exp`, so a
    // handful of cells land one ULP from NumPy; nothing downstream can see it.
    const { conf, nullShareS, nullShareP } = dualSoftmax(bundle)
    expect(conf.length).toBe(n * m)
    expect(maxDiff(conf, goldConf)).toBeLessThan(1e-5)

    // A note no window covered has an all -1e9 row against a +1e9 null. That row
    // minus its own max is 0 in the null slot and -2e9 everywhere else, so the
    // exponentials are 1 and 0 and the denominator is 1 — survivable, but only
    // if nothing along the way divides by zero. Assert it rather than assume it.
    expect(conf.some(Number.isNaN)).toBe(false)
    expect(nullShareS.some(Number.isNaN)).toBe(false)
    expect(nullShareP.some(Number.isNaN)).toBe(false)

    const { triples, trace } = decodeTraced(row, bundle)

    // Stage 1: anchors, before and after the monotone thinning.
    pairsEqual(trace.anchorsRaw, st.anchors_raw)
    pairsEqual(trace.anchors, st.anchors)

    // Stage 2: the cluster-DTW path and the two time maps.
    expect(trace.dtwAx.length).toBe(st.dtw_ax.length)
    expect(maxDiff(trace.dtwAx, st.dtw_ax)).toBe(0)
    expect(maxDiff(trace.dtwAy, st.dtw_ay)).toBe(0)
    expect(trace.map1Ax.length).toBe(st.map1_ax.length)
    expect(maxDiff(trace.map1Ax, st.map1_ax)).toBe(0)
    expect(maxDiff(trace.map1Ay, st.map1_ay)).toBe(0)

    // Stage 3: both assignment rounds and the rescue.
    expect(trace.roundsRun).toBe(st.rounds_run)
    expect(Array.from(trace.round1MatchedS)).toEqual(st.round1_matched_s)
    if (st.rounds_run > 1) {
        expect(trace.map2Ax).not.toBeNull()
        expect(trace.map2Ax!.length).toBe(st.map2_ax.length)
        expect(maxDiff(trace.map2Ax!, st.map2_ax)).toBe(0)
        expect(maxDiff(trace.map2Ay!, st.map2_ay)).toBe(0)
        expect(Array.from(trace.round2MatchedS!)).toEqual(st.round2_matched_s)
    }
    pairsEqual(trace.rescued, st.rescued)

    // Stage 4: the triples themselves — same count, order, labels and indices.
    expect(triples.length).toBe(manifest.triples.length)
    const mismatches: string[] = []
    let worstConf = 0
    for (let k = 0; k < manifest.triples.length; k++) {
        const got = triples[k]
        const want = manifest.triples[k]
        const gotScore = 'scoreIdx' in got ? got.scoreIdx : undefined
        const gotPerf = 'perfIdx' in got ? got.perfIdx : undefined
        if (got.label !== want.label || gotScore !== want.score_idx || gotPerf !== want.perf_idx) {
            if (mismatches.length < 5) {
                mismatches.push(
                    `[${k}] got ${got.label}(s=${gotScore},p=${gotPerf}) want ${want.label}(s=${want.score_idx},p=${want.perf_idx})`
                )
            }
        }
        const d = Math.abs(got.confidence - want.confidence)
        if (d > worstConf) worstConf = d
    }
    expect(mismatches).toEqual([])
    expect(worstConf).toBeLessThan(1e-5)

    return { n, m, triples: triples.length, worstConf }
}

const LOCAL_SLUGS = [
    'schubert-d783-15',
    // The same piece forced through five overlapping windows, so 39% of `sim`
    // is uncovered -1e9 and the softmax has to survive rows that are entirely
    // sentinel. It must still land on the identical 330 triples.
    'schubert-d783-15-win128',
    'mozart-k331-1st-mov',
    'chopin-op38-p19',
    // Three tiny synthetic pieces that reach the corners the repertoire does
    // not: a map too sparse to interpolate (the zeros fallback, one assignment
    // round); a leftover pair only the residual rescue recovers; and notes no
    // window covered at all, carrying the -1e9 / +1e9 sentinels.
    'synth-flat-map',
    'synth-rescue',
    'synth-uncovered',
    // The reachable half of that: coarse_windows guarantees every SCORE note
    // lands in a window, but a perf note further than MARGIN_SEC from any
    // window's anchors is covered by nothing — lead-in noise, applause, a
    // stray MIDI tail. Here the per-pitch DP then matches it at confidence 0.0.
    'synth-uncovered-perf',
]

describe('mlign decode — golden fixtures', () => {
    for (const slug of LOCAL_SLUGS) {
        it(`reproduces Python exactly on ${slug}`, () => {
            const dir = join(LOCAL_GOLDEN, slug)
            expect(existsSync(dir), `missing fixture ${slug}`).toBe(true)
            checkFixture(dir)
        })
    }

    // The berceuse is the largest piece and the only nine-window one, but its
    // fixtures are 25 MB. Run it from the MLign tree when that is checked out
    // alongside; skip cleanly when it is not.
    const optional = ['chopin-berceuse-op57']
    for (const slug of optional) {
        const dir = join(MLIGN_GOLDEN ?? '', slug)
        const present = MLIGN_GOLDEN !== undefined && existsSync(join(dir, 'manifest.json'))
        it.skipIf(!present)(`reproduces Python exactly on ${slug} (local only)`, () => {
            checkFixture(dir)
        })
    }
})

describe('mlign decode — NumPy semantics', () => {
    it('emulates float32 well enough that conf is not merely close', () => {
        // A guard on the claim the port rests on: agreement is at the ULP
        // level, not at some loose tolerance that would hide a real drift.
        const { bundle, conf: gold } = loadFixture(join(LOCAL_GOLDEN, 'schubert-d783-15'))
        const { conf } = dualSoftmax(bundle)
        let exact = 0
        for (let i = 0; i < conf.length; i++) if (conf[i] === gold[i]) exact++
        expect(exact / conf.length).toBeGreaterThan(0.99)
    })
})
