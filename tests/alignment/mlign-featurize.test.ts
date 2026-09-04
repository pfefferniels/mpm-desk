import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { N_CONT, featurizeWindow, tablesToRow } from '../../src/alignment/mlign/featurize'
import type { MlignRow, PerfNote, PerfRow, ScoreNote, ScoreRow, Window } from '../../src/alignment/mlign/types'

/**
 * Golden-fixture parity for the featurize port.
 *
 * Each fixture stores, per window, the exact tensors the Python handed the
 * model: `pitch`, `segment` and `position` inline in the manifest, and `cont` as
 * a raw little-endian float32 dump. The integer arrays have to match exactly —
 * they are indices and embedding lookups, and being off by one is not a rounding
 * error — while `cont` is allowed 1e-6, which is roughly ten float32 ulps at the
 * magnitudes involved and covers a libm disagreeing with NumPy about `log1p`.
 */

const LOCAL_GOLDEN = join(__dirname, 'golden')
/**
 * The berceuse is 25 MB of fixtures — too large to commit. Point `MLIGN_GOLDEN` at the MLign
 * tree's `test/golden` to run against it; unset, those cases skip.
 *
 * An env var rather than a fixed relative path, which would say where somebody's checkouts
 * happen to sit and resolve to nothing at all from a git worktree.
 */
const MLIGN_GOLDEN = process.env.MLIGN_GOLDEN

interface Manifest {
  meta: { n: number; m: number }
  score: ScoreNote[]
  perf: PerfNote[]
  row: { score: ScoreRow[]; perf: PerfRow[] }
  featurized: {
    window: [number, number, number, number]
    n: number
    m: number
    T: number
    pitch: number[]
    segment: number[]
    position: number[]
    cont: string
  }[]
}

function readF32(path: string): Float32Array {
  const b = readFileSync(path)
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

/** The fixture directory for a slug, or null if it was never generated here. */
function findFixture(slug: string): string | null {
  for (const root of [LOCAL_GOLDEN, MLIGN_GOLDEN].filter((root) => root !== undefined)) {
    const dir = join(root, slug)
    if (existsSync(join(dir, 'manifest.json'))) return dir
  }
  return null
}

function loadManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
}

/** Largest absolute gap, plus where it was, so a failure names one token. */
function worstDiff(got: ArrayLike<number>, want: ArrayLike<number>) {
  let worst = 0
  let at = -1
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(got[i] - want[i])
    if (d > worst) {
      worst = d
      at = i
    }
  }
  return { worst, at }
}

/** First index where two integer sequences disagree, or -1. */
function firstMismatch(got: BigInt64Array, want: number[]): number {
  for (let i = 0; i < want.length; i++) {
    if (Number(got[i]) !== want[i]) return i
  }
  return -1
}

// The four that fit in the app repo, then the windowed one that does not.
// `synth-flat-map` and `synth-rescue` are deliberately absent: being decode-only
// fixtures they carry no note tables and a null `featurized`, so there is nothing
// here to check them against — they appear in the windowing test instead. Every
// slug is optional: a fixture that has not been generated skips rather than fails,
// so a missing 25 MB directory never looks like a broken port.
const SLUGS = [
  'schubert-d783-15',
  'mozart-k331-1st-mov',
  'chopin-op38-p19',
  'schubert-d783-15-win128',
  'chopin-berceuse-op57',
]

describe.each(SLUGS)('featurize against %s', (slug) => {
  const dir = findFixture(slug)
  const runIf = dir ? it : it.skip

  runIf('rebuilds the row from the note tables', () => {
    const manifest = loadManifest(dir!)
    const row = tablesToRow(manifest.score, manifest.perf)

    expect(row.score).toEqual(manifest.row.score)
    expect(row.perf).toEqual(manifest.row.perf)
  })

  runIf('reproduces every window\'s tensors', () => {
    const manifest = loadManifest(dir!)
    const row: MlignRow = manifest.row

    let worstCont = 0
    for (const expected of manifest.featurized) {
      const got = featurizeWindow(row, expected.window as Window)

      expect(got.n).toBe(expected.n)
      expect(got.m).toBe(expected.m)
      expect(got.T).toBe(expected.T)

      expect(firstMismatch(got.pitch, expected.pitch)).toBe(-1)
      expect(firstMismatch(got.segment, expected.segment)).toBe(-1)
      expect(firstMismatch(got.position, expected.position)).toBe(-1)

      const wantCont = readF32(join(dir!, `${expected.cont}.f32.bin`))
      expect(got.cont.length).toBe(wantCont.length)
      expect(wantCont.length).toBe(expected.T * N_CONT)

      const { worst, at } = worstDiff(got.cont, wantCont)
      if (worst > worstCont) worstCont = worst
      // Thrown rather than asserted, so the message names the one token and
      // channel that drifted instead of dumping ~5000 floats.
      if (worst >= 1e-6) {
        throw new Error(
          `window ${expected.window}: cont token ${Math.floor(at / N_CONT)} ` +
            `channel ${at % N_CONT} off by ${worst}`
        )
      }
    }
    expect(worstCont).toBeLessThan(1e-6)
  })
})

describe('the token layout', () => {
  // Two score notes a quarter apart, two performed notes a second apart. Small
  // enough that every number below is arrived at by hand from the sidecar's
  // cont_channels expressions.
  const row: MlignRow = {
    score: [
      [720, 720, 60, 2],
      [1440, 360, 72, 2],
    ],
    perf: [
      [1000, 1000, 60, 64],
      [2000, 500, 72, 96],
    ],
  }
  const got = featurizeWindow(row, [0, 2, 0, 2])
  const channel = (token: number) => Array.from(got.cont.slice(token * N_CONT, (token + 1) * N_CONT))

  it('is marker, score, marker, perf', () => {
    expect(got.T).toBe(6)
    expect(Array.from(got.pitch, Number)).toEqual([128, 60, 72, 128, 60, 72])
    expect(Array.from(got.segment, Number)).toEqual([0, 0, 0, 1, 1, 1])
    expect(Array.from(got.position, Number)).toEqual([0, 1, 2, 0, 1, 2])
  })

  it('leaves both marker rows at zero', () => {
    expect(channel(0)).toEqual([0, 0, 0, 0, 0, 0])
    expect(channel(3)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('gives the first note of each half a delta of exactly zero', () => {
    // np.diff(onset, prepend=onset[0]) subtracts the first onset from itself.
    // The trap is emitting the onset (1.0 quarter, 1.0 s) instead.
    expect(channel(1)[0]).toBe(0)
    expect(channel(4)[0]).toBe(0)
    expect(channel(2)[0]).toBeCloseTo(Math.log1p(1.0 * 2), 6)
    expect(channel(5)[0]).toBeCloseTo(Math.log1p(1.0 * 2), 6)
  })

  it('scores duration, pitch and voice the way the sidecar says', () => {
    const [, dur, abs, pc, extra, flag] = channel(1)
    expect(dur).toBeCloseTo(Math.log1p(1.0 * 2), 6) // 720 ticks = 1 quarter
    expect(abs).toBeCloseTo(60 / 64 - 1, 6)
    expect(pc).toBeCloseTo((0 / 11) * 2 - 1, 6) // 60 % 12 === 0
    expect(extra).toBeCloseTo(2 / 4, 6) // the row already holds voice % 5
    expect(flag).toBe(0)
  })

  it('scores velocity for the perf half and flags it', () => {
    const [, dur, , , extra, flag] = channel(4)
    expect(dur).toBeCloseTo(Math.log1p(1.0 * 2), 6) // 1000 ms = 1 s
    expect(extra).toBeCloseTo(64 / 64 - 1, 6)
    expect(flag).toBe(1)
  })

  it('starts a window\'s deltas fresh rather than reaching back', () => {
    const window = featurizeWindow(row, [1, 2, 1, 2])
    expect(window.T).toBe(4)
    expect(Array.from(window.pitch, Number)).toEqual([128, 72, 128, 72])
    expect(window.cont[1 * N_CONT]).toBe(0)
    expect(window.cont[3 * N_CONT]).toBe(0)
  })

  it('clamps a backwards delta and a negative duration at zero', () => {
    const unsorted: MlignRow = {
      score: [
        [1440, 720, 60, 0],
        [720, -360, 62, 0],
      ],
      perf: [[0, 0, 60, 1]],
    }
    const out = featurizeWindow(unsorted, [0, 2, 0, 1])
    expect(out.cont[2 * N_CONT]).toBe(0) // delta would be -1 quarter
    expect(out.cont[2 * N_CONT + 1]).toBe(0) // duration would be -0.5 quarters
  })
})

describe('tablesToRow', () => {
  const score = (over: Partial<ScoreNote>): ScoreNote => ({
    id: 'n', onset: 0, duration: 1, pitch: 60, voice: 1, ...over,
  })
  const perf = (over: Partial<PerfNote>): PerfNote => ({
    id: 'p', onset: 0, duration: 1, pitch: 60, velocity: 64, ...over,
  })

  it('puts the score in PPQ-720 ticks and the performance in milliseconds', () => {
    const row = tablesToRow([score({ onset: 2.5, duration: 0.25 })], [perf({ onset: 1.5, duration: 0.125 })])
    expect(row.score[0]).toEqual([1800, 180, 60, 1])
    expect(row.perf[0]).toEqual([1500, 125, 60, 64])
  })

  it('folds voice with Python\'s modulo, not JavaScript\'s', () => {
    // Python's -1 % 5 is 4; JavaScript's is -1, which would index an embedding
    // out of range.
    expect(tablesToRow([score({ voice: 7 })], []).score[0][3]).toBe(2)
    expect(tablesToRow([score({ voice: -1 })], []).score[0][3]).toBe(4)
  })

  it('survives a score note before the first barline', () => {
    // Schubert D783/15 opens on an upbeat, so onset -1 quarter is real data.
    expect(tablesToRow([score({ onset: -1 })], []).score[0][0]).toBe(-720)
  })
})
