import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { wordFor } from './words'
import type { Reconstruction, Segment } from '../model/Reconstruction'

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: 's', from: 0, to: 100, spans: [], ...over,
})

describe('wordFor', () => {
  it('says what the corpus says, when the corpus says anything', () => {
    expect(wordFor(segment({ note: 'Abschattieren' }))).toBe('Abschattieren')
  })

  /**
   * One source of a word, and no fallback vocabulary behind it. A stand-in that reads like a
   * real word cannot be told from one on the branch, so a blank is the more honest drawing.
   */
  it('says nothing, visibly, when the segment says nothing', () => {
    expect(wordFor(segment())).toBe('Unbestimmt')
  })

  it('treats a blank note as no note', () => {
    expect(wordFor(segment({ note: '   ' }))).toBe('Unbestimmt')
  })

  it('gives every shipped segment a word', () => {
    const { segments } = JSON.parse(readFileSync('src/test/fixtures/segments.json', 'utf-8')) as Reconstruction
    for (const s of segments) {
      expect(wordFor(s).length, s.id).toBeGreaterThan(0)
    }
  })
})
