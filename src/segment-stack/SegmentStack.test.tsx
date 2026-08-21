/**
 * Mounts the stack over the files the app actually ships.
 *
 * The point is the whole path from `public/segments.json` to SVG: parse the MPM,
 * build the chains, negotiate the curve, and draw an onion per segment. Anything
 * that only holds for hand-written fixtures would not catch a bad bake.
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
import type { Reconstruction } from '../model/Reconstruction'

// The piano builds a Web Audio graph the moment it is imported, and jsdom has none.
// Nothing here is played, so the sound half is stood in for; the drawing half is real.
vi.mock('react-pianosound', () => ({
    PianoContextProvider: ({ children }: { children: ReactNode }) => children,
    usePiano: () => ({ play: () => { }, stop: () => { }, jumpTo: () => { } }),
}))

describe('SegmentStack over the shipped reconstruction', () => {
    it('draws an onion per visible segment and one intensity curve', async () => {
        const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction
        const mpm = readPerformance(readFileSync('public/performance.mpm', 'utf-8'), readMeter(readFileSync('public/score.msm', 'utf-8')))

        const container = document.createElement('div')
        document.body.appendChild(container)
        const root = createRoot(container)

        await act(async () => {
            root.render(
                <ZoomContext value={{ symbolic: { stretchX: 0.1 }, physical: { stretchX: 20 }, setStretchX: () => { } }}>
                    <PlaybackProvider scoreMsm="" performanceMpm="" dateByNoteId={new Map()}>
                        <SelectionProvider>
                            <ScrollSyncProvider zoom={0.1}>
                                <SegmentStack segments={segments} mpm={mpm} />
                            </ScrollSyncProvider>
                        </SelectionProvider>
                    </PlaybackProvider>
                </ZoomContext>
            )
        })

        const svg = container.querySelector('svg')
        expect(svg).not.toBeNull()

        // The viewBox is tick space: as wide as the last segment reaches.
        const maxDate = segments.reduce((max, s) => Math.max(max, s.to), 0)
        expect(svg!.getAttribute('viewBox')).toBe(`0 0 ${maxDate} 300`)

        const curve = container.querySelector('path.intensityCurve')
        expect(curve?.getAttribute('d')?.length).toBeGreaterThan(1000)

        // Three hit/fill paths per drawn onion, plus bar lines and the curve.
        expect(container.querySelectorAll('path').length).toBeGreaterThan(segments.length / 2)

        await act(async () => root.unmount())
        container.remove()
    })
})
