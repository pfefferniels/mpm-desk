import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { baselinePairs, coarseWindows, planWindows } from '../../src/alignment/mlign/windows'
import type { WindowOptions } from '../../src/alignment/mlign/windows'
import {
  DTW_GAP_BASELINE,
  MARGIN_SEC,
  MAX_SINGLE_TOKENS,
  PERF_CLUSTER_EPS,
  PERF_MS_PER_SEC,
  PPQ,
  SCORE_CLUSTER_EPS,
  WIN_SCORE,
  WIN_STRIDE,
} from '../../src/alignment/mlign/types'
import type { MlignRow, PerfRow, ScoreRow } from '../../src/alignment/mlign/types'

/**
 * Golden-fixture parity for the windowing port.
 *
 * The window tuples have to match exactly — a window is a hard boundary on what
 * the model is ever shown, so an index out by one is a different alignment, not
 * a rounding difference. Matching them transitively tests the baseline aligner
 * too, since the perf range of every window is derived from its anchor pairs;
 * the windowed fixtures additionally record those pairs, which is checked here
 * directly so a baseline failure is diagnosable on its own.
 */

const LOCAL_GOLDEN = join(__dirname, 'golden')
/** See `mlign-featurize.test.ts`: unset, the fixtures it names skip. */
const MLIGN_GOLDEN = process.env.MLIGN_GOLDEN

interface Manifest {
  meta: {
    n: number
    m: number
    windowed: boolean
    /** Present only on fixtures generated with non-default globals. */
    overrides?: Record<string, number>
    /** The values the fixture was actually generated with, overrides applied. */
    constants: Record<string, number>
  }
  row: { score: ScoreRow[]; perf: PerfRow[] }
  windows: [number, number, number, number][]
  baseline_pairs: [number, number][] | null
}

/**
 * The generator's constants, turned into the options `planWindows` takes.
 *
 * `schubert-d783-15-win128` is generated with `WIN_SCORE = 128` and
 * `MAX_SINGLE_TOKENS = 0` to get five real windows out of a 646-token piece.
 * Reading them from the manifest rather than assuming the defaults is the whole
 * point: comparing a 384-note plan against a 128-note one is not a test.
 *
 * Every constant the port does NOT take as an option is asserted to still hold
 * its default, so a future fixture that overrides one of those fails loudly here
 * instead of being silently ignored.
 */
function optionsFrom(manifest: Manifest): WindowOptions {
  const c = manifest.meta.constants
  expect(c.MARGIN_SEC).toBe(MARGIN_SEC)
  expect(c.DTW_GAP_BASELINE).toBe(DTW_GAP_BASELINE)
  expect(c.SCORE_CLUSTER_EPS).toBe(SCORE_CLUSTER_EPS)
  expect(c.PERF_CLUSTER_EPS).toBe(PERF_CLUSTER_EPS)
  // The stride is derived, not configured: the Python computes `WIN_SCORE // 2`
  // inside coarse_windows. A manifest that decoupled them would mean the port's
  // one-knob shape is wrong, so pin it.
  expect(c.WIN_STRIDE).toBe(c.WIN_SCORE >> 1)

  return { winScore: c.WIN_SCORE, maxSingleTokens: c.MAX_SINGLE_TOKENS, marginSec: c.MARGIN_SEC }
}

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

/** The two tables in the units the baseline works in: quarters and seconds. */
function columns(row: MlignRow) {
  return {
    sOnset: row.score.map((r) => r[0] / PPQ),
    sPitch: row.score.map((r) => r[2]),
    pOnset: row.perf.map((r) => r[0] / PERF_MS_PER_SEC),
    pPitch: row.perf.map((r) => r[2]),
  }
}

// All seven fixtures: every one records a `windows` array, the two synthetic
// ones included, even though they carry no note tables and no featurized
// tensors and so appear only here. Every slug is optional — a fixture that has
// not been generated skips rather than fails, so a missing 25 MB directory never
// looks like a broken port.
const SLUGS = [
  'schubert-d783-15',
  'mozart-k331-1st-mov',
  'chopin-op38-p19',
  'schubert-d783-15-win128',
  'chopin-berceuse-op57',
  'synth-flat-map',
  'synth-rescue',
]

describe.each(SLUGS)('windowing against %s', (slug) => {
  const dir = findFixture(slug)
  const runIf = dir ? it : it.skip

  runIf('plans exactly the windows the Python planned', () => {
    const manifest = loadManifest(dir!)
    const options = optionsFrom(manifest)
    const got = planWindows(manifest.row, options)

    expect(got.map((w) => [...w])).toEqual(manifest.windows)
    // A piece that fits goes through whole; one that does not is windowed. Both
    // paths are exercised across the fixture set, so assert which one this was.
    const tokens = 2 + manifest.meta.n + manifest.meta.m
    expect(tokens > options.maxSingleTokens!).toBe(manifest.meta.windowed)
  })

  runIf('reads its window size from the fixture, not from the defaults', () => {
    // The guard against the failure this test set actually caught: a hardcoded
    // 384 turned win128's five windows into one whole-piece window and matched
    // nothing. If a fixture overrides a global, the port has to be told.
    const manifest = loadManifest(dir!)
    const overrides = manifest.meta.overrides ?? {}
    const c = manifest.meta.constants

    expect(c.WIN_SCORE).toBe(overrides.WIN_SCORE ?? WIN_SCORE)
    expect(c.WIN_STRIDE).toBe(overrides.WIN_SCORE ? overrides.WIN_SCORE >> 1 : WIN_STRIDE)
    expect(c.MAX_SINGLE_TOKENS).toBe(overrides.MAX_SINGLE_TOKENS ?? MAX_SINGLE_TOKENS)

    if (Object.keys(overrides).length > 0) {
      // And the defaults really would have been wrong here — otherwise this
      // fixture is not testing what it was commissioned to test.
      expect(planWindows(manifest.row)).not.toEqual(manifest.windows)
    }
  })

  runIf('reproduces the baseline anchor pairs', () => {
    const manifest = loadManifest(dir!)
    if (!manifest.baseline_pairs) {
      // Only the windowed fixtures record them — coarse_windows is the only
      // caller of align_baseline, and a piece that fits never gets there.
      expect(manifest.meta.windowed).toBe(false)
      return
    }
    const { sOnset, sPitch, pOnset, pPitch } = columns(manifest.row)
    const flat = baselinePairs(sOnset, sPitch, pOnset, pPitch)

    expect(flat.length / 2).toBe(manifest.baseline_pairs.length)
    const bad: string[] = []
    for (let k = 0; k < manifest.baseline_pairs.length && bad.length < 5; k++) {
      const [wantS, wantP] = manifest.baseline_pairs[k]
      if (flat[2 * k] !== wantS || flat[2 * k + 1] !== wantP) {
        bad.push(`[${k}] got (${flat[2 * k]},${flat[2 * k + 1]}) want (${wantS},${wantP})`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('the window walk', () => {
  // Score notes one quarter apart, performed notes half a second apart, pitches
  // cycling so the cluster DTW's only zero-cost path is the true diagonal: every
  // deviation costs two gaps at 0.75 while the diagonal costs nothing. So the
  // baseline pairs note i with note i, and every window boundary below is
  // arrived at by hand.
  const N = 400
  const row: MlignRow = {
    score: Array.from({ length: N }, (_, i): ScoreRow => [i * PPQ, PPQ, 60 + (i % 12), 0]),
    perf: Array.from({ length: N }, (_, i): PerfRow => [i * 500, 500, 60 + (i % 12), 64]),
  }

  it('pairs the two tables note for note', () => {
    const { sOnset, sPitch, pOnset, pPitch } = columns(row)
    const flat = baselinePairs(sOnset, sPitch, pOnset, pPitch)

    expect(flat.length).toBe(2 * N)
    for (let i = 0; i < N; i++) {
      expect([flat[2 * i], flat[2 * i + 1]]).toEqual([i, i])
    }
  })

  it('strides by half a window and stops at the end of the score', () => {
    const windows = coarseWindows(row)
    // 400 score notes: [0, 384) then [192, 400). The loop breaks as soon as a
    // window reaches the end, so the last one is short and NOT stride-aligned.
    expect(windows.map((w) => [w[0], w[1]])).toEqual([
      [0, 384],
      [192, 400],
    ])
  })

  it('covers every score note, whatever the window size', () => {
    // Structural: windows start at multiples of the stride and span twice it, so
    // consecutive ones always overlap and their union is [0, n). Downstream code
    // may rely on this — no score note ever reaches the decode uncovered.
    for (const winScore of [2, 3, 17, 128, 384, 4096]) {
      const covered = new Set<number>()
      for (const [s0, s1] of coarseWindows(row, { winScore })) {
        for (let i = s0; i < s1; i++) covered.add(i)
      }
      expect(covered.size, `winScore ${winScore}`).toBe(N)
    }
  })

  it('overlaps consecutive windows by exactly winScore - stride', () => {
    // The tight form of the tiling property the score-coverage guarantee rests
    // on. It is `winScore - stride`, not `stride`: those coincide only for an
    // even window, and `stride = winScore // 2` floors, so an odd window
    // overlaps by one MORE than its stride. 129 is here for exactly that — it
    // strides 64 and overlaps 65.
    //
    // "Never less" holds because a truncated window never has a successor: the
    // loop breaks the moment a window reaches the end of the score, so the
    // predecessor of any emitted window is always a full `winScore` wide. Both
    // halves verified exhaustively over winScore x n before being written down.
    for (const winScore of [2, 3, 5, 8, 16, 128, 129, 384, 385]) {
      const stride = winScore >> 1
      const windows = coarseWindows(row, { winScore })
      for (let k = 0; k + 1 < windows.length; k++) {
        const label = `winScore ${winScore}, window ${k}`
        expect(windows[k][1] - windows[k][0], `${label} predecessor width`).toBe(winScore)
        expect(windows[k][1] - windows[k + 1][0], `${label} overlap`).toBe(winScore - stride)
      }
    }
  })

  it('does NOT cover every performed note, and that is the reference behaviour', () => {
    // The perf side has no such guarantee: a window's range is its anchors' span
    // widened by MARGIN_SEC, so performed notes further than that from the
    // nearest anchor are covered by no window at all. Both cases below were run
    // through the reference Python and produce these exact tuples and counts.
    const uncovered = (r: MlignRow) => {
      const covered = new Set<number>()
      const windows = coarseWindows(r)
      for (const [, , p0, p1] of windows) for (let j = p0; j < p1; j++) covered.add(j)
      return { windows: windows.map((w) => [...w]), count: r.perf.length - covered.size }
    }

    // 60 unmatched notes over the 6 s before the performance proper starts at 100 s.
    const leading = uncovered({
      score: row.score,
      perf: [
        ...Array.from({ length: 60 }, (_, j): PerfRow => [j * 100, 100, 21, 64]),
        ...Array.from({ length: N }, (_, i): PerfRow => [100000 + i * 500, 500, 60 + (i % 12), 64]),
      ],
    })
    expect(leading.windows).toEqual([[0, 384, 60, 450], [192, 400, 246, 460]])
    expect(leading.count).toBe(60)

    // 60 unmatched notes after the last match; the 3 s margin reaches the first
    // 26 of them and leaves 34 uncovered.
    const trailing = uncovered({
      score: row.score,
      perf: [
        ...row.perf,
        ...Array.from({ length: 60 }, (_, j): PerfRow => [200000 + j * 100, 100, 21, 64]),
      ],
    })
    expect(trailing.windows).toEqual([[0, 384, 0, 390], [192, 400, 186, 426]])
    expect(trailing.count).toBe(34)
  })

  it('rejects the window sizes the Python also refuses', () => {
    // `range(0, n, 192.0)` raises TypeError and `range(0, n, 0)` raises
    // ValueError, so both of these are refusals in the reference too — turning a
    // module constant into an option is what made them reachable. Neither has a
    // sensible repair: a fractional size puts fractional indices into the tuples
    // that everything downstream slices arrays with, and a size below 2 gives
    // stride 0, which either never advances or — if the stride were floored to 1
    // — emits one window per note, 400 model forward passes for 400 notes.
    for (const winScore of [0, 1, -384, 128.5, 383.9, NaN]) {
      expect(() => coarseWindows(row, { winScore }), `winScore ${winScore}`).toThrow(RangeError)
    }
    // planWindows forwards its options, so it refuses them too — but only once
    // it has decided the piece needs windowing at all.
    expect(() => planWindows(row, { winScore: 1, maxSingleTokens: 0 })).toThrow(RangeError)
  })

  it('emits only integer indices', () => {
    for (const winScore of [2, 3, 128, 384]) {
      for (const w of coarseWindows(row, { winScore })) {
        for (const v of w) expect(Number.isInteger(v), `winScore ${winScore}`).toBe(true)
      }
    }
  })

  it('takes searchsorted "left" at the low end and "right" at the high end', () => {
    const windows = coarseWindows(row)

    // Window 0 anchors run to perf note 383 at 191.5 s, so t_hi is 194.5 s —
    // exactly perf note 389's onset. "right" puts p1 one past it, at 390;
    // "left" would stop at 389 and drop a note the Python kept.
    expect(row.perf[389][0] / PERF_MS_PER_SEC).toBe(194.5)
    expect(windows[0]).toEqual([0, 384, 0, 390])

    // Window 1 anchors start at perf note 192 at 96 s, so t_lo is 93 s —
    // exactly perf note 186's onset. "left" includes it; "right" would start at
    // 187 and lose it.
    expect(row.perf[186][0] / PERF_MS_PER_SEC).toBe(93)
    expect(windows[1]).toEqual([192, 400, 186, 400])
  })

  it('falls back to the whole performance when a window has under two anchors', () => {
    // A score whose tail shares no pitch with the performance: the DTW still
    // walks the clusters diagonally (207 mismatched diagonals at 1.0 beat 414
    // gaps at 0.75), but nothing in the tail pairs. Muting from note 193 leaves
    // the second window, [192, 400), holding a single anchor.
    const mute: MlignRow = {
      score: row.score.map((r, i): ScoreRow => (i >= 193 ? [r[0], r[1], 21, r[3]] : r)),
      perf: row.perf,
    }
    const windows = coarseWindows(mute)

    // The full performance, not window 0's range [0, 199) and not a margin
    // around the one anchor it does have.
    expect(windows[0]).toEqual([0, 384, 0, 199])
    expect(windows[1]).toEqual([192, 400, 0, N])
  })

  it('gives up on windowing when the baseline finds no anchors at all', () => {
    const disjoint: MlignRow = {
      score: row.score.map((r): ScoreRow => [r[0], r[1], 21, r[3]]),
      perf: row.perf.map((r): PerfRow => [r[0], r[1], 108, r[3]]),
    }
    expect(coarseWindows(disjoint)).toEqual([[0, N, 0, N]])
  })

  it('derives the stride from the window size', () => {
    // types.ts now defines WIN_STRIDE as `WIN_SCORE >> 1` rather than a literal
    // 192, so this holds by construction there. Kept as a guard against it being
    // written back out as a number, which is what let the two drift apart in the
    // manifests' reader in the first place.
    expect(WIN_STRIDE).toBe(WIN_SCORE >> 1)

    // At WIN_SCORE 128 the stride is 64: 400 notes give windows starting at
    // 0, 64, … 320, the last one running short to 400.
    const starts = coarseWindows(row, { winScore: 128 }).map((w) => [w[0], w[1]])
    expect(starts).toEqual([
      [0, 128], [64, 192], [128, 256], [192, 320], [256, 384], [320, 400],
    ])
  })

  it('sends a piece that fits through the model whole', () => {
    const short: MlignRow = { score: row.score.slice(0, 40), perf: row.perf.slice(0, 40) }
    expect(2 + 40 + 40).toBeLessThanOrEqual(MAX_SINGLE_TOKENS)
    expect(planWindows(short)).toEqual([[0, 40, 0, 40]])
  })
})

describe('onset clustering', () => {
  it('splits the score on exact equality and the performance on 50 ms', () => {
    // Two score notes 1e-12 quarters apart are one cluster (the 1e-9 threshold
    // is an equality test in disguise); two performed notes 40 ms apart are one
    // cluster and 60 ms apart are two. Read out through the baseline: a chord
    // pairs only when both sides cluster the same way.
    const near: MlignRow = {
      score: [
        [0, PPQ, 60, 0],
        [1e-12 * PPQ, PPQ, 64, 0],
      ],
      perf: [
        [0, 500, 60, 64],
        [40, 500, 64, 64],
      ],
    }
    const c = columns(near)
    expect(Array.from(baselinePairs(c.sOnset, c.sPitch, c.pOnset, c.pPitch))).toEqual([0, 0, 1, 1])

    const split: MlignRow = { score: near.score, perf: [near.perf[0], [60, 500, 64, 64]] }
    const d = columns(split)
    // The score is still one two-note cluster but the performance is now two
    // one-note clusters, so the DTW can pair only one of them — and which one is
    // decided by a tie it walks into. Both cluster costs are 0.5, so reaching
    // (1, 2) diagonally and reaching it by a horizontal gap both sum to 1.25;
    // the backtrack tests `best === d` first, takes the diagonal, and pairs the
    // score cluster with the SECOND performed note. Verified against the Python.
    expect(Array.from(baselinePairs(d.sOnset, d.sPitch, d.pOnset, d.pPitch))).toEqual([1, 1])
  })

  it('pairs a repeated pitch inside a chord in table order', () => {
    // Both score notes are pitch 60 in one cluster; the queue is popped from the
    // front, so score 0 takes perf 0 and score 1 takes perf 1.
    const doubled: MlignRow = {
      score: [
        [0, PPQ, 60, 0],
        [0, PPQ, 60, 1],
      ],
      perf: [
        [0, 500, 60, 64],
        [10, 500, 60, 90],
      ],
    }
    const c = columns(doubled)
    expect(Array.from(baselinePairs(c.sOnset, c.sPitch, c.pOnset, c.pPitch))).toEqual([0, 0, 1, 1])
  })
})
