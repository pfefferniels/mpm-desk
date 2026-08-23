/**
 * Mounts the stack over the files the app actually ships.
 *
 * The point is the whole path from `public/segments.json` to SVG: parse the MPM,
 * read the nesting, pack every word into the tree and draw it.
 * Anything that only holds for hand-written fixtures would not catch a bad bake.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { act, type ReactNode } from 'react'
import { readPerformance } from '../utils/mpm'
import { readMeter } from '../utils/score'
import { ZoomContext } from '../hooks/ZoomProvider'
import { SelectionProvider } from '../hooks/SelectionProvider'
import { ScrollSyncProvider } from '../hooks/ScrollSyncProvider'
import { PlaybackProvider } from '../hooks/PlaybackProvider'
import { SegmentStack } from './SegmentStack'
import { wordFor } from './words'
import type { Reconstruction } from '../model/Reconstruction'

// The piano builds a Web Audio graph the moment it is imported, and jsdom has none.
// Nothing here is played, so the sound half is stood in for; the drawing half is real.
vi.mock('react-pianosound', () => ({
    PianoContextProvider: ({ children }: { children: ReactNode }) => children,
    usePiano: () => ({ play: () => { }, stop: () => { }, jumpTo: () => { } }),
}))

const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
const mpm = readPerformance(
    readFileSync('public/performance.mpm', 'utf-8'),
    readMeter(readFileSync('public/score.msm', 'utf-8')),
)

async function mount(stretchX: number) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
        root.render(
            <ZoomContext value={{ symbolic: { stretchX }, physical: { stretchX: stretchX * 200 }, setStretchX: () => { } }}>
                <PlaybackProvider scoreMsm="" performanceMpm="" dateByNoteId={new Map()}>
                    <SelectionProvider>
                        <ScrollSyncProvider zoom={stretchX}>
                            <SegmentStack segments={segments} mpm={mpm} />
                        </ScrollSyncProvider>
                    </SelectionProvider>
                </PlaybackProvider>
            </ZoomContext>
        )
    })

    const svg = container.querySelector('svg')!
    const words = [...svg.querySelectorAll('text')].filter(t => !t.closest('.barLines'))
    return {
        container,
        svg,
        words,
        cleanup: async () => {
            await act(async () => root.unmount())
            container.remove()
        },
    }
}

describe('SegmentStack over the shipped reconstruction', () => {
    it('says every segment, at every zoom, around one centre line', async () => {
        for (const stretchX of [0.005, 0.1]) {
            const { svg, words, cleanup } = await mount(stretchX)

            expect(svg.querySelectorAll('line.centreLine')).toHaveLength(1)
            // Nothing is ever culled — all 128 words are on screen.
            expect(words, `at zoom ${stretchX}`).toHaveLength(segments.length)

            const said = new Set(words.map(t => t.textContent))
            for (const s of segments) expect(said.has(wordFor(s)), s.id).toBe(true)

            await cleanup()
        }
    })

    it('writes every word along a branch, up for a root and down for a nested one', async () => {
        const { svg, words, cleanup } = await mount(0.05)

        // Each word is set on its own arc; the arc's far end says which way the
        // branch leans, and negative y is up out of the line.
        const leans = words.map(t => {
            const id = t.querySelector('textPath')!.getAttribute('href')!.slice(1)
            const d = svg.querySelector(`path[id="${CSS.escape(id)}"]`)!.getAttribute('d')!
            return Math.sign(Number(/A [\d.]+ [\d.]+ 0 0 [01] [-\d.]+ (-?[\d.]+)/.exec(d)![1]))
        })
        expect(leans).toHaveLength(segments.length)
        expect(leans.filter(l => l < 0).length).toBeGreaterThan(0)
        expect(leans.filter(l => l > 0).length).toBeGreaterThan(0)
        expect(leans.filter(l => l === 0)).toHaveLength(0)

        await cleanup()
    })

    it('sets a longer gesture in larger type', async () => {
        const { words, cleanup } = await mount(0.05)

        const spanOf = (w: Element) => {
            const s = segments.find(s => wordFor(s) === w.textContent)!
            return s.to - s.from
        }
        const sizeOf = (w: Element) => Number(w.getAttribute('font-size'))
        const longest = words.reduce((a, b) => (spanOf(a) >= spanOf(b) ? a : b))
        const shortest = words.reduce((a, b) => (spanOf(a) <= spanOf(b) ? a : b))
        expect(sizeOf(longest)).toBeGreaterThan(sizeOf(shortest))

        await cleanup()
    })

    it('grows the canvas to whatever the branches need', async () => {
        const { svg, cleanup } = await mount(0.05)
        const viewBox = svg.getAttribute('viewBox')!.split(' ')
        const maxDate = segments.reduce((max, s) => Math.max(max, s.to), 0)

        // X is tick space, Y is pixels — as tall as the tree reaches.
        expect(viewBox.slice(0, 3)).toEqual(['0', '0', String(maxDate)])
        expect(Number(viewBox[3])).toBeGreaterThan(200)
        expect(svg.getAttribute('height')).toBe(viewBox[3])

        await cleanup()
    })

    it('speaks up as the view comes closer', async () => {
        // The fade rides on `fill-opacity`, not a group `opacity` — see SegmentLabel.
        const opacityOf = (words: Element[]) => words
            .map(t => Number(t.getAttribute('fill-opacity') ?? 1))
            .reduce((a, b) => a + b, 0) / words.length

        const far = await mount(0.002)
        const farMean = opacityOf(far.words)
        await far.cleanup()

        const near = await mount(0.5)
        const nearMean = opacityOf(near.words)
        await near.cleanup()

        expect(nearMean).toBeGreaterThan(farMean)
    })
})
