/**
 * Playback renders on the caller's thread, over the files the app actually ships.
 *
 * The point is the contract the worker used to provide asynchronously: `play()` returns with
 * the piano already holding a parsed MIDI file, and that file carries one text meta event per
 * note-on naming the note — which is how the stack follows the playhead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { act, useEffect } from 'react'
import type { MidiFile } from 'midifile-ts'
import { ZoomContext } from './ZoomProvider'
import { PlaybackProvider, usePlayback } from './PlaybackProvider'

let played: MidiFile | null = null

// Same reason as in SegmentStack.test: the piano wants a Web Audio graph jsdom has not got.
// What is under test is everything before it — the render and the MIDI it produces.
vi.mock('react-pianosound', () => ({
    usePiano: () => ({
        play: (file: MidiFile) => { played = file },
        stop: () => { },
        jumpTo: () => { },
    }),
}))

const scoreMsm = readFileSync('public/score.msm', 'utf-8')
const performanceMpm = readFileSync('public/performance.mpm', 'utf-8')

let play: ReturnType<typeof usePlayback>['play'] | null = null

const Capture = () => {
    const playback = usePlayback()
    useEffect(() => { play = playback.play }, [playback.play])
    return null
}

const mount = async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(
            <ZoomContext value={{ symbolic: { stretchX: 20 }, physical: { stretchX: 20 }, setStretchX: () => { } }}>
                <PlaybackProvider scoreMsm={scoreMsm} performanceMpm={performanceMpm} dateByNoteId={new Map()}>
                    <Capture />
                </PlaybackProvider>
            </ZoomContext>
        )
    })
    return async () => { await act(async () => root.unmount()); container.remove() }
}

const noteIds = (file: MidiFile) => file.tracks
    .flat()
    .filter(event => event.type === 'meta' && event.subtype === 'text')
    .map(event => (event as { text: string }).text)

const velocities = (file: MidiFile) => file.tracks
    .flat()
    .filter(event => event.type === 'channel' && event.subtype === 'noteOn')
    .map(event => (event as { velocity: number }).velocity)

describe('PlaybackProvider', () => {
    beforeEach(() => {
        played = null
        play = null
        // espressivo narrates every conversion to the console.
        vi.spyOn(console, 'log').mockImplementation(() => { })
    })

    it('hands the piano a rendered performance without yielding', async () => {
        const unmount = await mount()

        // No await between the call and the assertion: were the render still behind a worker
        // (or any promise), nothing would have reached the piano by now.
        act(() => { play!({ exaggerate: 1 }) })

        expect(played).not.toBeNull()
        expect(played!.header.ticksPerBeat).toBe(720)

        const ids = noteIds(played!)
        expect(ids.length).toBeGreaterThan(400)
        expect(ids.every(id => scoreMsm.includes(`"${id}"`))).toBe(true)

        await unmount()
    })

    it('renders a spotlit segment, and renders it differently', async () => {
        const unmount = await mount()

        act(() => { play!({ exaggerate: 1 }) })
        const plain = played!

        // Instructions a segment names; espressivo damps everything else around them.
        const spotlit = [...performanceMpm.matchAll(/<dynamics [^>]*xml:id="([^"]+)"/g)].slice(0, 3).map(m => m[1])
        expect(spotlit.length).toBe(3)

        act(() => { play!({ mpmIds: spotlit, isolate: true }) })

        // The same notes sound, played differently: isolating three dynamics damps the rest.
        expect(noteIds(played!).length).toBe(noteIds(plain).length)
        expect(velocities(played!)).not.toEqual(velocities(plain))

        await unmount()
    })
})
