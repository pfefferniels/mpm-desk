// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { attributionRow, attributionsOf } from '../../src/alignment/mlign/attribution'
import { accumulateLogits } from '../../src/alignment/mlign/accumulate'
import { UNCOVERED_SIM, type MlignRow, type SimBundle } from '../../src/alignment/mlign/types'
import type { EncoderOutput, MlignSession, ModelFeeds, RunOptions } from '../../src/alignment/mlign/session'

/** `attr` is row-major (m, n): one row per played note, over the written ones. */
const bundle = (n: number, m: number, rows: number[][], none: number[]): SimBundle => ({
  n,
  m,
  sim: new Float32Array(n * m),
  nullS: new Float32Array(n),
  nullP: new Float32Array(m),
  attr: Float32Array.from(rows.flat()),
  attrNone: Float32Array.from(none),
})

describe('reading the ornament-attribution head', () => {
  it('names the written note a played note decorates', () => {
    const found = attributionsOf(bundle(3, 1, [[0, 8, 1]], [0]))

    expect(found.get(0)?.scoreIdx).toBe(1)
    expect(found.get(0)!.confidence).toBeGreaterThan(0.99)
    expect(found.get(0)!.share).toBeGreaterThan(0.99)
  })

  it('still ranks a note it calls no ornament, and says how little it believes it', () => {
    // The "none" column wins by a mile, which is the answer for most played
    // notes — but the ranking underneath it is still there to be looked at
    const found = attributionsOf(bundle(3, 1, [[1, 4, 1]], [9]))

    expect(found.get(0)?.scoreIdx).toBe(1)
    expect(found.get(0)!.confidence).toBeLessThan(0.01)
    expect(found.get(0)!.share).toBeGreaterThan(0.9)
  })

  it('keeps the two questions apart, because on real playing they come apart', () => {
    // Sure which written note, unsure that it is an ornament at all: exactly
    // what it does on a notated trill in a real recording
    const found = attributionsOf(bundle(2, 1, [[0, 6]], [8]))

    expect(found.get(0)!.confidence).toBeLessThan(0.15)
    expect(found.get(0)!.share).toBeGreaterThan(0.99)
  })

  it('decides nothing: every played note it was asked about comes back', () => {
    const found = attributionsOf(bundle(2, 3, [[1, 2], [0, 0], [5, 1]], [9, 9, 9]))

    expect(found.size).toBe(3)
  })

  it('says nothing at all about a played note no window covered', () => {
    const found = attributionsOf(
      bundle(2, 1, [[UNCOVERED_SIM, UNCOVERED_SIM]], [UNCOVERED_SIM])
    )

    expect(found.size).toBe(0)
  })

  it('is a softmax over the whole row, so a long piece dilutes a weak answer', () => {
    const many = Array.from({ length: 200 }, () => 1)
    many[7] = 2

    const found = attributionsOf(bundle(200, 1, [many], [1]))
    expect(found.get(0)?.scoreIdx).toBe(7)
    // 2 against 200 ones: the argmax is right and worth very little
    expect(found.get(0)!.confidence).toBeLessThan(0.05)
  })
})

/**
 * A session whose attribution head puts every played note on score note 1, and
 * whose alignment outputs are flat. Two windows' worth of vectors so the
 * averaging is exercised.
 */
const attributingSession = (): MlignSession => ({
  hasAttribution: true,
  attrConditioned: 'none',
  async run(feeds: ModelFeeds, options: RunOptions = {}): Promise<EncoderOutput> {
    const { n, m } = feeds
    const T = 2 + n + m
    const d = 4
    const out: EncoderOutput = {
      n,
      m,
      T,
      s: new Float32Array(T * d),
      p: new Float32Array(T * d),
      matchS: new Float32Array(T),
      matchP: new Float32Array(T),
      scale: 1,
    }
    if (!options.attribution) return out

    // attr_s puts score note 1 on a direction of its own; attr_p sends every
    // played note down it. attr_none stays orthogonal, so "none" scores 0.
    const attrS = new Float32Array(T * d)
    const attrP = new Float32Array(T * d)
    if (n > 1) attrS[(1 + 1) * d + 0] = 1
    for (let j = 0; j < m; j++) attrP[(2 + n + j) * d + 0] = 6

    return {
      ...out,
      attrS,
      attrP,
      attrNone: Float32Array.from([0, 1, 0, 0]),
      attrScale: 1,
    }
  },
  async release() {},
})

/** `[onset, duration, pitch, voice|velocity]`, in the model's own units. */
const row = (n: number, m: number): MlignRow => ({
  score: Array.from({ length: n }, (_, i) => [i * 720, 720, 60 + i, 0] as [number, number, number, number]),
  perf: Array.from({ length: m }, (_, j) => [j * 500, 250, 60 + j, 64] as [number, number, number, number]),
})

describe('accumulating the attribution head over windows', () => {
  it('brings it back only when it is asked for', async () => {
    const session = attributingSession()
    const plain = await accumulateLogits(session, row(3, 3), [[0, 3, 0, 3]])
    expect(plain.attr).toBeUndefined()

    const asked = await accumulateLogits(session, row(3, 3), [[0, 3, 0, 3]], undefined, {
      attribution: true,
    })
    expect(asked.attr).toHaveLength(9)
    expect(attributionsOf(asked).get(0)?.scoreIdx).toBe(1)
    expect(attributionsOf(asked).get(0)!.confidence).toBeGreaterThan(0.9)
  })

  it('leaves it out for a model whose graph has no such head', async () => {
    const session: MlignSession = { ...attributingSession(), hasAttribution: false }
    const bundle = await accumulateLogits(session, row(3, 3), [[0, 3, 0, 3]], undefined, {
      attribution: true,
    })

    expect(bundle.attr).toBeUndefined()
    expect(attributionsOf(bundle).size).toBe(0)
  })

  it('averages it rather than doubling it, as the match head is doubled', async () => {
    const session = attributingSession()
    const one = await accumulateLogits(session, row(4, 4), [[0, 4, 0, 4]], undefined, {
      attribution: true,
    })
    // Two overlapping windows over the same notes: the same value, averaged,
    // not summed and not doubled
    const two = await accumulateLogits(
      session,
      row(4, 4),
      [
        [0, 4, 0, 4],
        [0, 4, 0, 4],
      ],
      undefined,
      { attribution: true }
    )

    expect([...two.attr!]).toEqual([...one.attr!])
    expect([...two.attrNone!]).toEqual([...one.attrNone!])
    // 6 * 1, once, is what one window's dot product comes to
    expect(one.attr![0 * 4 + 1]).toBeCloseTo(6, 5)
  })

  it('marks a note no window reached rather than calling it no ornament', async () => {
    const session = attributingSession()
    const bundle = await accumulateLogits(session, row(4, 4), [[0, 4, 0, 2]], undefined, {
      attribution: true,
    })

    expect(bundle.attrNone![3]).toBe(UNCOVERED_SIM)
    expect(attributionsOf(bundle).has(3)).toBe(false)
    expect(attributionsOf(bundle).has(0)).toBe(true)
  })
})

/**
 * A v3 bundle. `simRows` is the *accumulated* (n, m) matrix, which holds twice
 * the raw similarity — the doubling `accumulateLogits` does — so these tests
 * see exactly what the app's own pipeline hands `attributionRow`.
 */
const factored = (
  n: number,
  m: number,
  attrRows: number[][],
  gate: number[],
  simRows: number[][],
  nullP: number[]
): SimBundle => ({
  n,
  m,
  sim: Float32Array.from(simRows.flat()),
  nullS: new Float32Array(n),
  nullP: Float32Array.from(nullP),
  attr: Float32Array.from(attrRows.flat()),
  attrNone: new Float32Array(m),
  attrGate: Float32Array.from(gate),
})

/** `log(sum(exp(row)))`, which a factored row must come to 0. */
const logSumExp = (row: Float64Array | number[]): number => {
  const vs = [...row].filter((v) => v !== -Infinity)
  const mx = Math.max(...vs)
  return mx + Math.log(vs.reduce((s, v) => s + Math.exp(v - mx), 0))
}

describe('the factored attribution row (v3)', () => {
  it('is already a distribution: the row exponentiates to 1', () => {
    const row = attributionRow(
      factored(3, 1, [[2, 0, -1]], [0.5], [[1], [0], [-2]], [0.25]),
      0
    )!

    expect(logSumExp(row)).toBeCloseTo(0, 10)
    expect([...row].reduce((s, v) => s + Math.exp(v), 0)).toBeCloseTo(1, 10)
  })

  it('reads the match head from the undoubled p->s logits', () => {
    // n = 2, m = 1. attr [2, 0], gate 0, nullP 0, and an accumulated sim column
    // of [2, 0] — which is the raw [1, 0] the model itself would have seen,
    // doubled by the accumulation. Taking the doubled column at face value
    // gives 0.0469 / 0.0063 / 0.9467 instead: a sharper p->s softmax, a smaller
    // P(insertion), and an ornament note the app's 0.35 threshold would drop.
    const row = attributionRow(factored(2, 1, [[2, 0]], [0], [[2], [0]], [0]), 0)!

    expect(Math.exp(row[0])).toBeCloseTo(0.093339, 5)
    expect(Math.exp(row[1])).toBeCloseTo(0.012632, 5)
    expect(Math.exp(row[2])).toBeCloseTo(0.894029, 5)
  })

  it('lets the gate move mass between ornamenting and not, and nothing else', () => {
    const of = (g: number) => attributionRow(factored(2, 1, [[3, 0]], [g], [[0], [0]], [0]), 0)!
    const shut = of(-8)
    const open = of(8)

    // A shut gate sends the row to "not an ornament"; an open one leaves it on
    // whatever the match head allowed. The ranking between the two written
    // notes is the same either way — that is what "factored" means.
    expect(Math.exp(shut[2])).toBeGreaterThan(Math.exp(open[2]))
    expect(shut[0] - shut[1]).toBeCloseTo(open[0] - open[1], 10)
    expect(logSumExp(shut)).toBeCloseTo(0, 10)
    expect(logSumExp(open)).toBeCloseTo(0, 10)
  })

  it('floors the match head, so a certain match cannot silence the ranking', () => {
    // A p->s row this lopsided puts P(insertion) far below exp(-12); without
    // the floor the ornament half of the row would go to zero outright.
    const row = attributionRow(factored(2, 1, [[4, 0]], [4], [[80], [0]], [-80]), 0)!

    expect(Math.exp(row[0])).toBeGreaterThan(0)
    expect(row[0]).toBeGreaterThan(-14)
    // The clamp is the one thing that leaves a row off being exactly a
    // distribution: it hands back mass the match head had taken away. A hair
    // above zero, and only where the floor bit.
    expect(logSumExp(row)).toBeGreaterThan(0)
    expect(logSumExp(row)).toBeLessThan(1e-4)
  })

  it('keeps `share` the ranking alone, unmoved by how sure the match head is', () => {
    // Two played notes with the same attribution row and gate but opposite
    // verdicts from the match head: the confidences differ, the shares do not.
    const attr = [
      [2, 0],
      [2, 0],
    ]
    const found = attributionsOf(
      factored(2, 2, attr, [0, 0], [[0, 0], [0, 0]], [6, -6])
    )

    expect(found.get(0)!.share).toBeCloseTo(found.get(1)!.share, 10)
    expect(found.get(0)!.confidence).toBeGreaterThan(found.get(1)!.confidence)
  })

  it('is exponentiated, never softmaxed again', () => {
    const bundle = factored(3, 1, [[2, 0, -1]], [0.5], [[1], [0], [-2]], [0.25])
    const row = attributionRow(bundle, 0)!
    const found = attributionsOf(bundle)!

    expect(found.get(0)!.scoreIdx).toBe(0)
    expect(found.get(0)!.confidence).toBeCloseTo(Math.exp(row[0]), 12)
    expect(found.get(0)!.share).toBeCloseTo(Math.exp(row[0] - logSumExp([...row].slice(0, 3))), 12)
  })

  it('says nothing about a played note no window covered', () => {
    const bundle = factored(
      2,
      1,
      [[UNCOVERED_SIM, UNCOVERED_SIM]],
      [UNCOVERED_SIM],
      [[UNCOVERED_SIM], [UNCOVERED_SIM]],
      [1e9]
    )

    expect(attributionRow(bundle, 0)).toBeUndefined()
    expect(attributionsOf(bundle).size).toBe(0)
  })
})

/**
 * The third number, and the one the decode acts on.
 *
 * `confidence` and `share` are both read off the row. The gate is not, and that
 * is the whole point of it: the row has been through the match head and the gate
 * has not, so for a played note the decode has already ruled an insertion the
 * gate is the only one of the three still answering the question that was asked.
 */
describe('the gate, which is what survives a decoded insertion', () => {
  it('is the sigmoid of the accumulated logit, straight from the graph', () => {
    const found = attributionsOf(factored(2, 1, [[2, 0]], [1.5], [[0], [0]], [0]))

    expect(found.get(0)!.gate).toBeCloseTo(1 / (1 + Math.exp(-1.5)), 12)
  })

  it('does not move when the match head does, though the row mass does', () => {
    // Two played notes, same head and same ranking, opposite verdicts from the
    // match head: nullP 6 is an insertion it is content with, -6 one it is sure
    // it matched. The second is the vetoed note, and its gate is the first's.
    const found = attributionsOf(
      factored(2, 2, [[2, 0], [2, 0]], [1.5, 1.5], [[0, 0], [0, 0]], [6, -6])
    )

    expect(found.get(1)!.gate).toBeCloseTo(found.get(0)!.gate, 12)
    expect(found.get(1)!.confidence).toBeLessThan(found.get(0)!.confidence / 100)
  })

  it('does not move with the ranking either, which is why both are reported', () => {
    // A gate can be confident over a ranking that is not, and the two together
    // are what an acceptance test asks. Nothing is decided here; `share` is
    // reported beside the gate so that `../divergences` can decide.
    const of = (attr: number[]) =>
      attributionsOf(factored(3, 1, [attr], [0.8], [[0], [0], [0]], [0])).get(0)!
    const sharp = of([6, 0, 0])
    const flat = of([0.1, 0, 0])

    expect(sharp.gate).toBeCloseTo(flat.gate, 12)
    expect(sharp.share).toBeGreaterThan(flat.share)
    expect(flat.share).toBeLessThan(0.4)
  })

  it('falls back on the row before v3, where there is no such tensor', () => {
    // v1 and v2 have only the row, so the gate is what the row says once the
    // "not an ornament" column is set aside - the same fallback the Python
    // takes for an unconditioned head.
    const found = attributionsOf(bundle(3, 1, [[1, 4, 1]], [9]))

    const cells = [1, 4, 1, 9].map(Math.exp)
    const total = cells.reduce((sum, v) => sum + v, 0)
    expect(found.get(0)!.gate).toBeCloseTo((total - cells[3]) / total, 10)
    expect(found.get(0)!.gate).toBeLessThan(0.01)
  })
})

/** The same fake head, exported as a `"factored"` graph would export it. */
const factoredSession = (): MlignSession => {
  const base = attributingSession()
  return {
    ...base,
    attrConditioned: 'factored',
    async run(feeds: ModelFeeds, options: RunOptions = {}): Promise<EncoderOutput> {
      const out = await base.run(feeds, options)
      if (!options.attribution) return out
      const { n, m } = feeds
      const gate = new Float32Array(2 + n + m)
      for (let j = 0; j < m; j++) gate[2 + n + j] = 2
      return { ...out, attrGate: gate }
    },
  }
}

describe('accumulating the gate over windows', () => {
  it('carries it only for a graph that emits it', async () => {
    const plain = await accumulateLogits(attributingSession(), row(3, 3), [[0, 3, 0, 3]], undefined, {
      attribution: true,
    })
    expect(plain.attrGate).toBeUndefined()

    const v3 = await accumulateLogits(factoredSession(), row(3, 3), [[0, 3, 0, 3]], undefined, {
      attribution: true,
    })
    expect([...v3.attrGate!]).toEqual([2, 2, 2])
  })

  it('averages it, as the null logits are averaged', async () => {
    const two = await accumulateLogits(
      factoredSession(),
      row(4, 4),
      [
        [0, 4, 0, 4],
        [0, 4, 0, 4],
      ],
      undefined,
      { attribution: true }
    )

    expect([...two.attrGate!]).toEqual([2, 2, 2, 2])
  })

  it('sentinels a played note no window reached', async () => {
    const bundle = await accumulateLogits(factoredSession(), row(4, 4), [[0, 4, 0, 2]], undefined, {
      attribution: true,
    })

    expect(bundle.attrGate![3]).toBe(UNCOVERED_SIM)
    expect(attributionRow(bundle, 3)).toBeUndefined()
    expect(attributionsOf(bundle).has(3)).toBe(false)
    expect(attributionsOf(bundle).has(0)).toBe(true)
  })
})
