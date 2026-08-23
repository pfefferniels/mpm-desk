import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { arcOf, buildChains, containmentDepths, fadeOpacities, laneOf, LabelPlacement, LINE_HEIGHT_RATIO, packLabels, pointSpanFallback, treeGeometry, typeScale } from './StackModel'
import type { Reconstruction, Segment, Span } from '../model/Reconstruction'

const span = (over: Partial<Span> = {}): Span => ({
  id: 'tempo_0', type: 'tempo', from: 0, to: 100, elements: ['tempo_0'], ...over,
})

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: 's', motivation: 'intensify', certainty: 'plausible', from: 0, to: 100, spans: [span()], ...over,
})

describe('buildChains', () => {
  it('leaves unlinked segments out', () => {
    const chains = buildChains([segment({ id: 'a' }), segment({ id: 'b', from: 200, to: 300 })])
    expect(chains.size).toBe(0)
  })

  it('spans the whole chain, in order, for every member', () => {
    const a = segment({ id: 'a', from: 0, to: 100 })
    const b = segment({ id: 'b', from: 90, to: 200, continue: 'a' })
    const c = segment({ id: 'c', from: 180, to: 300, continue: 'b' })

    const chains = buildChains([c, a, b])
    expect(chains.get('a')).toEqual({ chainFrom: 0, chainTo: 300, memberIds: ['a', 'b', 'c'] })
    expect(chains.get('b')).toBe(chains.get('a'))
    expect(chains.get('c')).toBe(chains.get('a'))
  })

  it('ignores a `continue` that names nothing', () => {
    const chains = buildChains([segment({ id: 'a', continue: 'gone' })])
    expect(chains.size).toBe(0)
  })

  it('terminates on a cycle', () => {
    const a = segment({ id: 'a', continue: 'b' })
    const b = segment({ id: 'b', from: 100, to: 200, continue: 'a' })
    const chains = buildChains([a, b])
    expect(chains.get('a')?.memberIds).toHaveLength(2)
  })
})

describe('laneOf', () => {
  it('leaves a span that already has extent alone', () => {
    const s = span({ from: 10, to: 90 })
    expect(laneOf(s, 0, 100)).toBe(s)
  })

  it('extends a point-like span backwards by a fifth of the segment', () => {
    expect(laneOf(span({ from: 100, to: 100 }), 0, 100).from).toBe(80)
  })

  it('never reaches back past the segment', () => {
    expect(laneOf(span({ from: 10, to: 10 }), 0, 100).from).toBe(0)
  })

  it('gives a point inside a point-like segment something to draw', () => {
    expect(laneOf(span({ from: 50, to: 50 }), 50, 50)).toMatchObject({ from: 49, to: 50 })
  })
})

describe('fadeOpacities', () => {
  const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
  const chains = buildChains(segments)
  const minPointSpan = pointSpanFallback(segments)

  it('never culls — every segment keeps a visible mark at every zoom', () => {
    for (const stretchX of [0.001, 0.005, 0.02, 0.1, 0.5, 2]) {
      const fade = fadeOpacities({ segments, chains, stretchX, minPointSpan })
      for (const s of segments) {
        expect(fade.get(s.id), `${s.id} at ${stretchX}`).toBeGreaterThan(0)
      }
    }
  })

  it('brings the small gestures forward as the view comes closer', () => {
    const small = [...segments].sort((a, b) => (a.to - a.from) - (b.to - b.from))[10]
    const far = fadeOpacities({ segments, chains, stretchX: 0.002, minPointSpan }).get(small.id)!
    const near = fadeOpacities({ segments, chains, stretchX: 1, minPointSpan }).get(small.id)!
    expect(near).toBeGreaterThan(far)
    expect(near).toBe(1)
  })

  it('fades a chain as one gesture', () => {
    for (const stretchX of [0.005, 0.05, 0.5]) {
      const fade = fadeOpacities({ segments, chains, stretchX, minPointSpan })
      for (const chain of new Set(chains.values())) {
        const values = chain.memberIds.map(id => fade.get(id))
        expect(new Set(values).size, `chain at ${stretchX}`).toBe(1)
      }
    }
  })
})

describe('containmentDepths', () => {
  it('counts how many segments strictly contain each one', () => {
    const depths = containmentDepths([
      segment({ id: 'outer', from: 0, to: 1000 }),
      segment({ id: 'mid', from: 100, to: 900 }),
      segment({ id: 'inner', from: 200, to: 800 }),
    ])
    expect(depths.get('outer')).toBe(0)
    expect(depths.get('mid')).toBe(1)
    expect(depths.get('inner')).toBe(2)
  })

  it('does not let identical ranges contain each other', () => {
    const depths = containmentDepths([
      segment({ id: 'a', from: 0, to: 100 }),
      segment({ id: 'b', from: 0, to: 100 }),
    ])
    expect(depths.get('a')).toBe(0)
    expect(depths.get('b')).toBe(0)
  })

  it('finds real nesting in the shipped corpus', () => {
    const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
    const depths = containmentDepths(segments)
    const histogram = new Map<number, number>()
    for (const d of depths.values()) histogram.set(d, (histogram.get(d) ?? 0) + 1)
    expect(depths.size).toBe(segments.length)
    expect(histogram.get(0)).toBeGreaterThan(0)
    expect(Math.max(...histogram.keys())).toBeGreaterThanOrEqual(2)
  })
})

describe('packLabels', () => {
  const LINE_HEIGHT = 14

  const pack = (
    segments: Segment[],
    over: { stretchX?: number; length?: number } = {},
  ) => packLabels({
    segments,
    depths: containmentDepths(segments),
    minPointSpan: 10,
    stretchX: over.stretchX ?? 1,
    metricsOf: () => ({ length: over.length ?? 100, lineHeight: LINE_HEIGHT }),
  })

  /**
   * Walk both branches and see whether they ever come within a line height.
   *
   * Sampled twice as finely as the packer samples, so this is an independent
   * check on the geometry rather than a restatement of the packer's own test.
   */
  const collide = (a: LabelPlacement, b: LabelPlacement, stretchX = 1) => {
    if (a.side !== b.side) return false
    const walk = (l: LabelPlacement) => {
      const arc = arcOf(l.length, l.side)
      const steps = Math.max(4, Math.ceil(l.length / 3))
      return Array.from({ length: steps + 1 }, (_, i) => {
        const p = arc.at((l.length * i) / steps)
        return { x: l.tick * stretchX + p.x, y: l.side * l.offset + p.y }
      })
    }
    const pa = walk(a), pb = walk(b)
    for (const p of pa) {
      for (const q of pb) {
        if (Math.hypot(p.x - q.x, p.y - q.y) < LINE_HEIGHT * 0.9) return true
      }
    }
    return false
  }

  it('places every segment, and never two words on top of each other', () => {
    // Deliberately cramped: 40 long words whose feet are only 5 ticks apart.
    const many = Array.from({ length: 40 }, (_, i) =>
      segment({ id: `s${i}`, from: i * 5, to: i * 5 + 400 }))
    const placed = pack(many)
    expect(placed).toHaveLength(40)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(collide(placed[i], placed[j]), `${placed[i].segment.id} vs ${placed[j].segment.id}`).toBe(false)
      }
    }
  })

  it('leans roots up and everything nested down', () => {
    const placed = pack([
      segment({ id: 'root', from: 0, to: 1000 }),
      segment({ id: 'nested', from: 100, to: 400 }),
    ])
    expect(placed.find(l => l.segment.id === 'root')!.side).toBe(-1)
    expect(placed.find(l => l.segment.id === 'nested')!.side).toBe(1)
  })

  it('pushes deeper words further from the line', () => {
    const placed = pack([
      segment({ id: 'outer', from: 0, to: 1000 }),
      segment({ id: 'mid', from: 100, to: 900 }),
      segment({ id: 'inner', from: 200, to: 800 }),
    ])
    const at = (id: string) => placed.find(l => l.segment.id === id)!
    expect(at('inner').offset).toBeGreaterThan(at('mid').offset)
  })

  it('lets long words share the innermost tier once their feet clear on the lean', () => {
    // This is the whole point of the tilt: the clearance a word needs is a fixed
    // spacing between feet, and its length costs nothing horizontally.
    const gap = Math.ceil(LINE_HEIGHT / Math.sin(26 * Math.PI / 180)) + 2
    const spread = Array.from({ length: 12 }, (_, i) =>
      segment({ id: `s${i}`, from: i * gap, to: i * gap + 1 }))
    const placed = pack(spread, { length: 400 })
    expect(new Set(placed.map(l => l.offset)).size).toBe(1)
  })

  it('stacks them outwards when the feet are too close to clear', () => {
    const crowded = Array.from({ length: 12 }, (_, i) =>
      segment({ id: `s${i}`, from: i, to: i + 1 }))
    const placed = pack(crowded, { length: 400 })
    expect(new Set(placed.map(l => l.offset)).size).toBeGreaterThan(1)
  })

  it('places all 128 of the shipped corpus without a collision', () => {
    const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
    const stretchX = 0.0157 // the fit-to-window zoom
    const placed = packLabels({
      segments,
      depths: containmentDepths(segments),
      minPointSpan: pointSpanFallback(segments),
      stretchX,
      metricsOf: (s: Segment) => ({
        length: (s.note?.length ?? 12) * 6.4 + 12,
        lineHeight: LINE_HEIGHT,
      }),
    })
    expect(placed).toHaveLength(segments.length)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(collide(placed[i], placed[j], stretchX)).toBe(false)
      }
    }
  })
})

describe('treeGeometry', () => {
  const label = (over: Partial<LabelPlacement> = {}): LabelPlacement => ({
    segment: segment(), tick: 0, side: -1, offset: 10, depth: 0, length: 100, fontSize: 11, ...over,
  })

  it('makes room for how far the longest word reaches', () => {
    const short = treeGeometry({ labels: [label({ length: 100 })], minHeight: 0 })
    const long = treeGeometry({ labels: [label({ length: 600 })], minHeight: 0 })
    expect(long.totalHeight).toBeGreaterThan(short.totalHeight)
  })

  it('counts each side separately, so the line sits where the branches leave it', () => {
    const g = treeGeometry({
      labels: [label({ side: -1, length: 100 }), label({ side: 1, length: 600 })],
      minHeight: 0,
    })
    expect(g.centreY).toBeLessThan(g.totalHeight / 2)
  })

  it('never falls below the viewport it scrolls inside', () => {
    expect(treeGeometry({ labels: [label({ length: 1 })], minHeight: 260 }).totalHeight).toBe(260)
  })
})

describe('typeScale', () => {
  it('writes a longer gesture larger', () => {
    const sizes = typeScale({
      segments: [
        segment({ id: 'brief', from: 0, to: 100 }),
        segment({ id: 'long', from: 0, to: 4000 }),
      ],
      minPointSpan: 10,
      fontScale: 1,
      charsOf: () => 12,
    })
    expect(sizes.get('long')!).toBeGreaterThan(sizes.get('brief')!)
  })

  it('gives a point-like gesture the fallback span rather than nothing', () => {
    const sizes = typeScale({
      segments: [segment({ id: 'point', from: 500, to: 500 }), segment({ id: 'long', from: 0, to: 4000 })],
      minPointSpan: 200,
      fontScale: 1,
      charsOf: () => 12,
    })
    expect(sizes.get('point')!).toBeGreaterThan(0)
    expect(sizes.get('point')!).toBeLessThan(sizes.get('long')!)
  })

  it('scales the whole range with exaggeration', () => {
    const args = { segments: [segment({ id: 'a', from: 0, to: 1000 })], minPointSpan: 10, charsOf: () => 12 }
    const rest = typeScale({ ...args, fontScale: 1 }).get('a')!
    const loud = typeScale({ ...args, fontScale: 1.7 }).get('a')!
    expect(loud).toBeCloseTo(rest * 1.7)
  })

  it('sets a very long word smaller so its branch cannot run away', () => {
    const sizes = typeScale({
      segments: [
        // A short one, so the scale has a range to work over at all.
        segment({ id: 'brief', from: 0, to: 40 }),
        segment({ id: 'terse', from: 0, to: 4000 }),
        segment({ id: 'wordy', from: 0, to: 4000 }),
      ],
      minPointSpan: 10,
      fontScale: 1,
      charsOf: s => (s.id === 'wordy' ? 76 : 6),
    })
    // Same duration, so only the length of the word separates these two.
    expect(sizes.get('wordy')!).toBeLessThan(sizes.get('terse')!)
  })

  it('keeps the shipped corpus inside a readable range', () => {
    const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
    const sizes = [...typeScale({
      segments, minPointSpan: pointSpanFallback(segments), fontScale: 1,
      charsOf: s => (s.note ?? 'Unbestimmt').length,
    }).values()]
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(7)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20)
  })
})

describe('arcOf', () => {
  it('starts at the foot and leaves the line the way the branch leans', () => {
    const up = arcOf(100, -1)
    expect(up.at(0).x).toBeCloseTo(0)
    expect(up.at(0).y).toBeCloseTo(0)
    expect(up.end.y).toBeLessThan(0)   // above the line
    expect(up.end.x).toBeGreaterThan(0)
    expect(arcOf(100, 1).end.y).toBeGreaterThan(0)
  })

  it('bends towards the horizontal, so it reaches less far up than a straight ray would', () => {
    const length = 300
    const arc = arcOf(length, -1)
    // A straight 45° ray of the same length would rise length·sin45°.
    expect(arc.reach).toBeLessThan(length * Math.SQRT1_2)
  })

  it('keeps one handwriting: a long word turns as far as a short one', () => {
    const short = arcOf(100, -1)
    const long = arcOf(500, -1)
    // Same total turn means the radius grows with the length.
    expect(long.radius / short.radius).toBeCloseTo(5, 1)
  })

  it('survives a word with no length', () => {
    expect(() => arcOf(0, -1)).not.toThrow()
    expect(arcOf(0, -1).reach).toBe(0)
  })

  it('agrees with LINE_HEIGHT_RATIO being a sane leading', () => {
    expect(LINE_HEIGHT_RATIO).toBeGreaterThan(1)
    expect(LINE_HEIGHT_RATIO).toBeLessThan(2)
  })
})
