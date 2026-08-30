// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { loadVerovio, renderPerformance, staffSpace } from '../../src/verovio/toolkit'
import {
  clearOmissionMarks,
  drawOmissionMarks,
  type OmittedGroup,
} from '../../src/verovio/omissionMarks'
import type { VerovioToolkit } from 'verovio/esm'

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')

/** A note verovio drew, and where it drew it. */
interface Drawn {
  id: string
  x: number
  staff: string
}

let root: HTMLDivElement
let drawn: Drawn[]

beforeAll(async () => {
  const tk: VerovioToolkit = await loadVerovio()
  const pages = renderPerformance(tk, mei, { performanceRecording: '1' })

  root = document.createElement('div')
  root.innerHTML = pages.join('')
  document.body.appendChild(root)

  drawn = []
  for (const note of root.querySelectorAll('.note')) {
    const t = note
      .querySelector('.notehead use')
      ?.getAttribute('transform')
      ?.match(/translate\(\s*([-0-9.]+)/)
    const staff = note.closest('.staff')?.getAttribute('data-id')
    const id = note.getAttribute('data-id')
    if (!t || !staff || !id) continue

    drawn.push({ id, x: Number(t[1]), staff })
  }
}, 60_000)

afterEach(() => clearOmissionMarks(root))

const group = (ids: string[], extra: Partial<OmittedGroup> = {}): OmittedGroup => ({
  divergenceId: 'missing-0',
  scoreIds: ids,
  resolved: false,
  ...extra,
})

const marks = () => [...root.querySelectorAll('.performanceOmission')]
const hidden = () => [...root.querySelectorAll('.note[data-omitted]')]
/** What verovio drew for those notes without drawing it inside them */
const orphans = () => [...root.querySelectorAll('.chord[data-omitted], .beam[data-omitted]')]

/** Notes verovio drew on top of each other: a chord, and the crowding to answer. */
function crowded(): Drawn[] {
  const byPlace = new Map<string, Drawn[]>()
  for (const note of drawn) {
    const key = `${note.staff}@${Math.round(note.x)}`
    byPlace.set(key, [...(byPlace.get(key) ?? []), note])
  }

  return [...byPlace.values()].find((notes) => notes.length >= 2) ?? []
}

/** Notes of one staff with a comfortable stretch of music between them. */
function roomy(): Drawn[] {
  const space = staffSpace()
  const byStaff = new Map<string, Drawn[]>()
  for (const note of drawn) {
    byStaff.set(note.staff, [...(byStaff.get(note.staff) ?? []), note])
  }

  for (const on of byStaff.values()) {
    const sorted = [...on].sort((a, b) => a.x - b.x)
    const chosen = [sorted[0]]
    for (const note of sorted) {
      if (note.x - chosen[chosen.length - 1].x > space) chosen.push(note)
      if (chosen.length === 3) return chosen
    }
  }

  return []
}

describe('marking a passage the recording passes over', () => {
  it('leaves a single unplayed note to stand as its own notehead', () => {
    drawOmissionMarks(root, [group([drawn[0].id])])

    expect(marks()).toHaveLength(0)
    expect(hidden()).toHaveLength(0)
  })

  it('takes out a group crowded into no space, and says how many notes it holds', () => {
    const notes = crowded()
    expect(notes.length).toBeGreaterThan(1)

    drawOmissionMarks(root, [group(notes.map((note) => note.id))])

    expect(marks()).toHaveLength(1)
    expect(hidden()).toHaveLength(notes.length)
    expect(marks()[0].querySelector('text')?.textContent).toBe(String(notes.length))
  })

  it('leaves the notes of a group that has room where they are', () => {
    const notes = roomy()
    expect(notes).toHaveLength(3)

    drawOmissionMarks(root, [group(notes.map((note) => note.id))])

    expect(marks()).toHaveLength(1)
    expect(hidden()).toHaveLength(0)
    // Nothing to count: they can be counted where they stand
    expect(marks()[0].querySelector('text')).toBeNull()
  })

  // The stem of a chord belongs to the chord, so taking the notes out on their
  // own leaves a stem standing over nothing
  it('takes what the notes held up out with them', () => {
    const notes = crowded()
    const chord = root.querySelector(`[data-id="${notes[0].id}"]`)?.closest('.chord')
    expect(chord).not.toBeNull()

    drawOmissionMarks(root, [group(notes.map((note) => note.id))])

    expect(orphans()).toContain(chord)
  })

  it('leaves alone a group with a note still standing in it', () => {
    const notes = crowded()
    drawOmissionMarks(root, [group([notes[0].id, drawn.find((n) => n.id !== notes[0].id)!.id])])

    const chord = root.querySelector(`[data-id="${notes[0].id}"]`)?.closest('.chord')
    expect(orphans()).not.toContain(chord)
  })

  it('puts back everything it took out', () => {
    const notes = crowded()
    drawOmissionMarks(root, [group(notes.map((note) => note.id))])
    clearOmissionMarks(root)

    expect(marks()).toHaveLength(0)
    expect(hidden()).toHaveLength(0)
    expect(orphans()).toHaveLength(0)
    for (const note of notes) {
      const element = root.querySelector(`[data-id="${note.id}"]`) as SVGElement
      expect(element.style.display).toBe('')
    }
  })

  it('brackets each staff of an omission that reaches both hands', () => {
    const staves = [...new Set(drawn.map((note) => note.staff))]
    expect(staves.length).toBeGreaterThan(1)

    // The first note of each of two staves: they sound together, so nothing
    // stands between them and the group is crowded either way
    const notes = staves.slice(0, 2).map((staff) => drawn.find((note) => note.staff === staff)!)
    drawOmissionMarks(root, [group(notes.map((note) => note.id))])

    expect(marks()).toHaveLength(2)
    expect(new Set(marks().map((mark) => mark.closest('.staff')?.getAttribute('data-id')))).toEqual(
      new Set(staves.slice(0, 2))
    )
  })

  it('carries the divergence, so that clicking the bracket asks about it', () => {
    const notes = crowded()
    drawOmissionMarks(root, [group(notes.map((note) => note.id), { divergenceId: 'missing-7' })])

    expect(marks()[0].getAttribute('data-divergence')).toBe('missing-7')
  })

  it('draws in the colour it was given', () => {
    const notes = crowded()
    drawOmissionMarks(root, [group(notes.map((note) => note.id))], { colour: '#c9ced6' })

    expect(marks()[0].querySelector('path')?.getAttribute('stroke')).toBe('#c9ced6')
  })
})
