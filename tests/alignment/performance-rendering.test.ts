import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { JSDOM } from 'jsdom'
import type { VerovioToolkit } from 'verovio/esm'
import { loadVerovio, renderPerformance, defaultOptions } from '../../src/verovio/toolkit'
import { readPerformedNote } from '../../src/verovio/performedNote'
import { loadFixture, renderToPng, comparePng } from './setup'

const SNAPSHOT_DIR = join(__dirname, '__snapshots__')
/**
 * A picture of what `vendor/verovio` engraves, so it is a picture of *that build*.
 *
 * `npm run verovio:build` invalidates it wholesale — the fork's own layout changes are exactly
 * what the snapshot is watching for, and one of them moves every system on the page. Delete it
 * and re-run to take a new one, after checking by eye that the change was the intended one.
 */
const BASELINE_PNG = join(SNAPSHOT_DIR, 'performance-baseline.png')

/** Written only when the comparison fails, so a red run leaves something to look at */
const RENDERED_PNG = join(SNAPSHOT_DIR, 'performance-rendered.png')
const OVERLAY_PNG = join(SNAPSHOT_DIR, 'performance-overlay.png')

/** Percent of the page allowed to differ */
const TOLERATED_SHARE = 0.1

/** MEI units one second of performed time covers, before the page is scaled down */
const UNITS_PER_SECOND = defaultOptions.performanceScale! * 90

let toolkit: VerovioToolkit
let mei: string
let pages: string[]

function notesOf(svg: string) {
  const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document

  return [...document.querySelectorAll('.note')].flatMap((element) => {
    const note = readPerformedNote(element)
    const translate = element
      .querySelector('.notehead use')
      ?.getAttribute('transform')
      ?.match(/translate\(\s*([-0-9.]+)/)

    if (!note || !translate) return []
    return [{ ...note, x: Number(translate[1]), system: element.closest('.system')?.getAttribute('data-id') }]
  })
}

beforeAll(async () => {
  toolkit = await loadVerovio()
  mei = readFileSync(join(__dirname, '..', '..', 'public', 'transcription.mei'), 'utf-8')
  pages = renderPerformance(toolkit, mei, { performanceRecording: '1' })
})

describe('the vendored toolkit', () => {
  it('is the fork that knows the performance options', () => {
    const options = toolkit.getAvailableOptions() as unknown as {
      groups: Record<string, { options: Record<string, unknown> }>
    }
    const performance = options.groups['8-performance']

    expect(performance, 'no performance option group — is vendor/verovio the fork?').toBeDefined()
    expect(Object.keys(performance.options)).toContain('performanceAlignment')
  })
})

describe('laying a score out in performed time', () => {
  it('renders every system of the recording', () => {
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[0]).toContain('class="note"')
  })

  it('gives each note the time it was performed at', () => {
    const notes = notesOf(pages[0])
    expect(notes.length).toBeGreaterThan(20)
    expect(notes.every((note) => note.onsetMs !== undefined)).toBe(true)
  })

  it('puts every note of a system where its onset falls on the time axis', () => {
    const systems = Map.groupBy(notesOf(pages[0]), (note) => note.system)
    expect(systems.size).toBeGreaterThan(1)

    for (const [, notes] of systems) {
      const earliest = notes.reduce((a, b) => (a.onsetMs! <= b.onsetMs! ? a : b))
      const deviation = notes.map((note) =>
        Math.abs(note.x - earliest.x - ((note.onsetMs! - earliest.onsetMs!) / 1000) * UNITS_PER_SECOND)
      )

      // A notehead displaced to the other side of its stem is the one thing that
      // moves a note off its own time, and it moves it by less than its own width
      expect(Math.max(...deviation)).toBeLessThan(350)
      expect(deviation.filter((d) => d <= 2).length).toBeGreaterThan(notes.length / 2)
    }
  })

  it('breaks the systems by performed duration', () => {
    const spans = [...Map.groupBy(notesOf(pages[0]), (note) => note.system).values()].map((notes) => {
      const onsets = notes.map((note) => note.onsetMs!)
      return (Math.max(...onsets) - Math.min(...onsets)) / 1000
    })

    expect(Math.max(...spans)).toBeLessThanOrEqual(defaultOptions.performanceSystemDuration!)
  })

  it('draws a ruler of the performed time', () => {
    expect(pages[0]).toContain('class="performanceRuler"')
  })

  it('renders the velocity of a note as ink density', () => {
    const opacities = [...pages[0].matchAll(/opacity="([0-9.]+)"/g)].map((m) => Number(m[1]))
    expect(opacities.length).toBeGreaterThan(0)
    expect(Math.min(...opacities)).toBeLessThan(Math.max(...opacities))
  })
})

describe('choosing a recording', () => {
  it('lays the same note out at the time each recording played it', () => {
    const onsetOf = (recording: string) => {
      const notes = notesOf(renderPerformance(toolkit, mei, { performanceRecording: recording })[0])
      return new Map(notes.map((note) => [note.id, note.onsetMs]))
    }

    const first = onsetOf('1')
    const second = onsetOf('2')

    const shared = [...first.keys()].filter((id) => second.has(id))
    expect(shared.length).toBeGreaterThan(0)
    expect(shared.some((id) => first.get(id) !== second.get(id))).toBe(true)
  })
})

describe('notes the recording says nothing about', () => {
  /** The MEI with the first ten <when> elements dropped */
  const withoutSomeWhens = () => {
    let dropped = 0
    return mei.replace(/<when\b[\s\S]*?<\/when>/g, (when) => (dropped++ < 10 ? '' : when))
  }

  it('marks them, and hides them when asked to', () => {
    const partial = withoutSomeWhens()

    const marked = notesOf(renderPerformance(toolkit, partial, {
      performanceRecording: '1',
      performanceUnmatched: 'mark',
    })[0])
    const hidden = notesOf(renderPerformance(toolkit, partial, {
      performanceRecording: '1',
      performanceUnmatched: 'hide',
    })[0])

    expect(marked.some((note) => note.unaligned)).toBe(true)
    expect(hidden.filter((note) => note.unaligned)).toHaveLength(0)
    expect(hidden.length).toBeLessThan(marked.length)
  })
})

describe('reading a note back out of the score', () => {
  it('reports what the recording knows about it', () => {
    const note = notesOf(pages[0]).find((note) => note.velocity !== undefined)!

    expect(note.id).toMatch(/\S/)
    expect(note.onsetMs).toBeGreaterThan(0)
    expect(note.offsetMs!).toBeGreaterThan(note.onsetMs!)
    expect(note.velocity).toBeGreaterThan(0)
    expect(note.pitch).toBeGreaterThan(20)
    expect(note.unaligned).toBe(false)
  })
})

describe('the score the toolkit reads for the alignment', () => {
  it('still reports a timemap and MIDI values', () => {
    toolkit.setOptions({ appXPathQuery: ["./rdg[contains(@source, 'performance')]"] })
    toolkit.loadData(loadFixture('traumerei.mei'))
    toolkit.renderToMIDI()

    const timemap = toolkit.renderToTimemap()
    expect(timemap.length).toBeGreaterThan(0)
    expect(timemap[0]).toHaveProperty('qstamp')

    const onset = timemap.find((entry) => 'on' in entry && Array.isArray(entry.on) && entry.on.length)!
    expect(onset).toBeDefined()
    expect(typeof toolkit.getMIDIValuesForElement(onset.on![0]).pitch).toBe('number')
  })
})

describe('visual regression', () => {
  it('renders the first system as before', () => {
    const png = renderToPng(pages[0])

    if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true })
    if (!existsSync(BASELINE_PNG)) {
      writeFileSync(BASELINE_PNG, png)
      console.log('Baseline PNG saved. Re-run to compare.')
      return
    }

    const { share, overlay } = comparePng(readFileSync(BASELINE_PNG), png)
    if (share >= TOLERATED_SHARE) {
      writeFileSync(RENDERED_PNG, png)
      writeFileSync(OVERLAY_PNG, overlay)
    }

    expect(
      share,
      `Visual diff is ${share.toFixed(2)}% — exceeds ${TOLERATED_SHARE}%. What differs is in ${OVERLAY_PNG}`,
    ).toBeLessThan(TOLERATED_SHARE)
  })
})
