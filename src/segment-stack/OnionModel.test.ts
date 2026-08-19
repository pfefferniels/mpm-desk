import { describe, it, expect } from 'vitest'
import { buildChains, laneOf } from './OnionModel'
import type { Segment, Span } from '../model/Reconstruction'

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
