// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Score } from '../../src/verovio/Score'
import { readPerformedNote } from '../../src/verovio/performedNote'
import type { OmittedGroup } from '../../src/verovio/omissionMarks'
import { performedOptions, unitsPerSecond } from '../../src/verovio/toolkit'

/**
 * The three overlays, drawn through `<Score>`.
 *
 * This checked `<PerformedScore>` in aligned-mei, which mpm-desk does not have: `Score` already
 * engraves, already survives React replacing its SVG, and already delegates a click, so the
 * overlays went onto it rather than beside it. What is checked is the same drawing.
 */

const mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')
const options = { ...performedOptions, performanceRecording: '1' }

let container: HTMLDivElement
let root: Root
const clicked: string[] = []

async function show(extenders: boolean, omissions?: OmittedGroup[]) {
  await act(async () => {
    root.render(
      <Score
        mei={mei}
        options={options}
        extenders={extenders}
        omissions={omissions}
        onNoteClick={(id) => clicked.push(id)}
      />
    )
  })
}

/** Where an extender runs, and whether it is closed with a release tick */
function geometryOf(extender: Element) {
  const d = extender.getAttribute('d')!
  const line = d.match(/^M([-0-9.]+) ([-0-9.]+) H([-0-9.]+)/)!

  return {
    start: Number(line[1]),
    y: Number(line[2]),
    end: Number(line[3]),
    closed: d.includes('V'),
  }
}

/** Give the toolkit the turns it needs to load and lay the score out */
async function settle(until: () => boolean) {
  for (let attempt = 0; attempt < 200 && !until(); attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
}

beforeAll(async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await show(false)
  await settle(() => container.querySelector('.note') !== null)
}, 60_000)

describe('a score laid out along its recording', () => {
  it('renders every system of the performance', () => {
    expect(container.querySelectorAll('.system').length).toBeGreaterThan(1)
    expect(container.querySelectorAll('.note').length).toBeGreaterThan(50)
    expect(container.querySelector('.performanceRuler')).not.toBeNull()
  })

  it('reports the note that was clicked, and says when it sounded', () => {
    const notehead = container.querySelector('.note .notehead use')!
    const note = notehead.closest('.note')!

    notehead.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toBe(note.getAttribute('data-id'))

    // What the click reports is the id; the performed reading is on the element, which is where
    // `readPerformedNote` takes it from.
    const performed = readPerformedNote(note)!
    expect(performed.id).toBe(clicked[0])
    expect(performed.onsetMs).toBeGreaterThan(0)
    expect(performed.pitch).toBeGreaterThan(20)
  })

  it('draws no extenders unless it is asked to', () => {
    expect(container.querySelectorAll('.performanceExtender')).toHaveLength(0)
  })

  it('extends a note to where the recording released it', async () => {
    await show(true)

    const extenders = [...container.querySelectorAll('.performanceExtender')]
    expect(extenders.length).toBeGreaterThan(20)

    let reachedTheRelease = 0

    for (const extender of extenders) {
      const note = extender.closest('.note')!
      const held =
        (Number(note.getAttribute('data-perf-offset')) -
          Number(note.getAttribute('data-perf-onset'))) /
        1000

      const noteX = Number(
        note
          .querySelector('.notehead use')!
          .getAttribute('transform')!
          .match(/translate\(\s*([-0-9.]+)/)![1]
      )

      const released = noteX + held * unitsPerSecond(options)
      const { start, end, closed } = geometryOf(extender)

      // The line starts clear of the notehead and runs flat to the release, or to
      // the end of the system when the note was still held there
      expect(start).toBeGreaterThan(noteX)
      expect(end).toBeLessThanOrEqual(released + 1)

      if (Math.abs(end - released) < 1) {
        // Only a line that reached the release is closed with a tick
        expect(closed).toBe(true)
        reachedTheRelease++
      } else {
        expect(closed).toBe(false)
      }
    }

    expect(reachedTheRelease).toBeGreaterThan(extenders.length / 2)
  })

  it('cuts a line off at the end of its system', () => {
    for (const extender of container.querySelectorAll('.performanceExtender')) {
      const staves = [...extender.closest('.system')!.querySelectorAll('.staff > path')]
      const edge = Math.max(
        ...staves.map((line) => Number(line.getAttribute('d')!.match(/L\s*([-0-9.]+)/)![1]))
      )

      expect(geometryOf(extender).end).toBeLessThanOrEqual(edge + 1)
    }
  })

  it('takes the extenders away again', async () => {
    await show(false)
    expect(container.querySelectorAll('.performanceExtender')).toHaveLength(0)
  })

  it('brackets a passage the recording passes over, and takes it away again', async () => {
    const ids = [...container.querySelectorAll('.note')]
      .slice(0, 4)
      .map((note) => note.getAttribute('data-id')!)

    await show(false, [{ divergenceId: 'missing-0', scoreIds: ids, resolved: false }])
    expect(container.querySelectorAll('.performanceOmission').length).toBeGreaterThan(0)

    await show(false)
    expect(container.querySelectorAll('.performanceOmission')).toHaveLength(0)
    expect(container.querySelectorAll('[data-omitted]')).toHaveLength(0)
  })

  it('says nothing about a click that missed the notes', () => {
    const before = clicked.length
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicked).toHaveLength(before)
  })
})
