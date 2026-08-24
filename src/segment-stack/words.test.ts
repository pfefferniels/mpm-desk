import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { wordFor } from './words'
import type { Reconstruction, Segment } from '../model/Reconstruction'

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: 's', motivation: 'intensify', from: 0, to: 100, spans: [], ...over,
})

describe('wordFor', () => {
  it('says what the corpus says, when the corpus says anything', () => {
    expect(wordFor(segment({ note: 'Abschattieren' }))).toBe('Abschattieren')
  })

  it('prefers the note over the motivation', () => {
    expect(wordFor(segment({ motivation: 'calm', note: 'Hinspielen auf 1' }))).toBe('Hinspielen auf 1')
  })

  it('falls back to the motivation when there is no note', () => {
    expect(wordFor(segment({ motivation: 'calm' }))).toBe('Beruhigen')
  })

  it('treats a blank note as no note', () => {
    expect(wordFor(segment({ motivation: 'relax', note: '   ' }))).toBe('Zurücknehmen')
  })

  it('has something to say about an unknown motivation', () => {
    expect(wordFor(segment({ motivation: 'unknown' }))).toBe('Unbestimmt')
    expect(wordFor(segment({ motivation: 'nonsense' }))).toBe('Unbestimmt')
  })

  it('gives every shipped segment a word', () => {
    const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
    for (const s of segments) {
      expect(wordFor(s).length, s.id).toBeGreaterThan(0)
    }
  })
})
