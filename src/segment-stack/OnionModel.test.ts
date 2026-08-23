import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildChains, computeLodOpacities, laneOf, pointSpanFallback } from './OnionModel'
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

describe('computeLodOpacities over the shipped reconstruction', () => {
  const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
  const chains = buildChains(segments)
  const minPointSpan = pointSpanFallback(segments)
  const spanOf = (id: string) => {
    const member = segments.find(s => s.id === id)!
    return member.to - member.from
  }

  it('has chains to speak of', () => {
    expect(chains.size).toBeGreaterThan(0)
  })

  it('keeps every chain member at the same opacity, at every zoom', () => {
    for (const stretchX of [0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2]) {
      const lod = computeLodOpacities({ segments, chains, stretchX, minPointSpan })
      for (const chain of new Set(chains.values())) {
        const opacities = chain.memberIds.map(id => lod.get(id))
        expect(new Set(opacities).size, `chain ${chain.memberIds.join('+')} at ${stretchX}`).toBe(1)
      }
    }
  })

  it('fades a chain by its whole extent, not by its members', () => {
    // A chain reaches wider than any one of its members: at a zoom where the
    // widest member alone would have gone, the chain is still drawn.
    const chain = [...new Set(chains.values())]
      .find(c => c.chainTo - c.chainFrom > Math.max(...c.memberIds.map(spanOf)))
    expect(chain).toBeDefined()

    const widestMember = Math.max(...chain!.memberIds.map(spanOf))
    const chainSpan = chain!.chainTo - chain!.chainFrom
    const stretchX = 30 / ((widestMember + chainSpan) / 2)
    expect(widestMember * stretchX).toBeLessThan(30)
    expect(chainSpan * stretchX).toBeGreaterThan(30)

    const lod = computeLodOpacities({ segments, chains, stretchX, minPointSpan })
    expect(lod.get(chain!.memberIds[0])).toBeGreaterThan(0)
  })
})
