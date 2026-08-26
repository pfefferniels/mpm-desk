/**
 * Playback renders on the caller's thread, over the files the app actually ships.
 *
 * The point is the contract: `play()` returns with the piano already holding a parsed MIDI file,
 * and that file carries one text meta event per note-on naming the note — which is how the stack
 * follows the playhead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { act, useEffect } from 'react'
import type { MidiFile } from 'midifile-ts'
import { addAbsoluteTime } from 'react-pianosound'
import { indexNoteIds, renderedRange } from '../utils/anchor'
import { createFakePiano } from '../test/fakePiano'
import { readNoteDates } from '../utils/score'
import { ZoomContext } from './ZoomProvider'
import { PlaybackProvider, usePlayback } from './PlaybackProvider'

// Same reason as in SegmentStack.test: the piano wants a Web Audio graph jsdom has not got. The
// rig underneath is faithful about the two things that matter — a passed tick never fires again,
// and the sampler is idempotent — so the splice logic is genuinely exercised, not stubbed out.
let rig = createFakePiano()

vi.mock('react-pianosound', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-pianosound')>(),
    usePiano: () => rig.usePiano(),
}))

const played = () => rig.played[rig.played.length - 1] ?? null

const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8')
const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8')
const dateByNoteId = readNoteDates(scoreMsm)

let play: ReturnType<typeof usePlayback>['play'] | null = null
let setExaggeration: ReturnType<typeof usePlayback>['setExaggeration'] | null = null

const Capture = () => {
    const playback = usePlayback()
    useEffect(() => { play = playback.play }, [playback.play])
    useEffect(() => { setExaggeration = playback.setExaggeration }, [playback.setExaggeration])
    return null
}

const mount = async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(
            <ZoomContext value={{ symbolic: { stretchX: 20 }, physical: { stretchX: 20 }, setStretchX: () => { } }}>
                <PlaybackProvider scoreMsm={scoreMsm} performanceMpm={performanceMpm} dateByNoteId={dateByNoteId}>
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
        rig = createFakePiano()
        play = null
        setExaggeration = null
        // espressivo narrates every conversion to the console.
        vi.spyOn(console, 'log').mockImplementation(() => { })
    })

    it('hands the piano a rendered performance without yielding', async () => {
        const unmount = await mount()

        // No await between the call and the assertion: were the render behind a worker or any
        // other promise, nothing would have reached the piano by now.
        act(() => { play!({ exaggerate: 1 }) })

        expect(played()).not.toBeNull()
        expect(played()!.header.ticksPerBeat).toBe(720)

        const ids = noteIds(played()!)
        expect(ids.length).toBeGreaterThan(400)
        expect(ids.every(id => scoreMsm.includes(`"${id}"`))).toBe(true)

        await unmount()
    })

    it('renders a spotlit segment, and renders it differently', async () => {
        const unmount = await mount()

        act(() => { play!({ exaggerate: 1 }) })
        const plain = played()!

        // Instructions a segment names; espressivo damps everything else around them.
        const spotlit = [...performanceMpm.matchAll(/<dynamics [^>]*xml:id="([^"]+)"/g)].slice(0, 3).map(m => m[1])
        expect(spotlit.length).toBe(3)

        act(() => { play!({ mpmIds: spotlit, isolate: true }) })

        // The same notes sound, played differently: isolating three dynamics damps the rest.
        expect(noteIds(played()!).length).toBe(noteIds(plain).length)
        expect(velocities(played()!)).not.toEqual(velocities(plain))

        await unmount()
    })
})

describe('moving the exaggeration knob while it plays', () => {
    beforeEach(() => {
        rig = createFakePiano()
        play = null
        setExaggeration = null
        vi.spyOn(console, 'log').mockImplementation(() => { })
    })

    /** Drag the slider from 1 to `to` in `steps`, `stepMs` apart, letting the piece play under it. */
    const drag = (to: number, steps: number, stepMs: number, fromSecond: number) => {
        for (let i = 1; i <= steps; i++) {
            act(() => { setExaggeration!(1 + ((to - 1) * i) / steps) })
            act(() => { vi.advanceTimersByTime(stepMs) })
            act(() => { rig.transport.advanceTo(fromSecond + (i * stepMs) / 1000) })
        }
        act(() => { vi.advanceTimersByTime(500) })
    }

    it('splices instead of restarting, and leaves the sounding notes ringing', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ exaggerate: 1 }) })
            act(() => { rig.transport.advanceTo(20) })

            const soundingBefore = rig.piano.held.size + rig.piano.sustained.size
            expect(soundingBefore).toBeGreaterThan(0)

            drag(1.5, 10, 40, 20)

            // The knob never reached for the piano's stop button: one play() for the whole run.
            expect(rig.played.length).toBe(1)
            expect(rig.splices.length).toBeGreaterThan(0)

            // Nothing was damped on the way through: releasing the held notes and lifting the
            // pedal on each step is what makes the knob sound like an event.
            expect(rig.piano.held.size + rig.piano.sustained.size).toBeGreaterThan(0)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it('throttles a fast drag instead of spending a render per step', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ exaggerate: 1 }) })
            act(() => { rig.transport.advanceTo(20) })

            // 20 steps in 200 ms, against a 100 ms floor.
            drag(1.9, 20, 10, 20)

            expect(rig.splices.length).toBeGreaterThanOrEqual(1)
            expect(rig.splices.length).toBeLessThanOrEqual(5)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it('carries the value the drag ended on, not the one that armed the timer', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ exaggerate: 1 }) })
            act(() => { rig.transport.advanceTo(20) })

            act(() => { setExaggeration!(1.2) })
            act(() => { setExaggeration!(1.5) })
            act(() => { setExaggeration!(1.9) })
            act(() => { vi.advanceTimersByTime(500) })

            // One trailing update, and it renders the last value: the piece has to be at its
            // longest, which only the top of the slider produces.
            const spliced = rig.splices.at(-1)!
            expect(spliced).toBeTruthy()
            const lastEvent = rig.usePiano().getSchedule()!.events.at(-1)!
            expect(lastEvent.abs / 1000).toBeGreaterThan(185)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it('leaves no note hanging and never starves the polyphony', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ exaggerate: 1 }) })
            act(() => { rig.transport.advanceTo(40) })

            act(() => { setExaggeration!(1.9) })
            act(() => { vi.advanceTimersByTime(500) })
            expect(rig.splices.length).toBe(1)

            // Play the rest of it out.
            act(() => { rig.transport.advanceTo(400) })

            expect(rig.piano.held.size).toBe(0)
            expect(rig.piano.sustained.size).toBe(0)
            // @tonejs/piano drops notes silently once the voice budget is full; a sustain left
            // stuck down at a seam is exactly how that happens.
            expect(rig.piano.dropped).toBe(0)
            expect(rig.piano.maxVoices).toBeLessThan(rig.piano.maxPolyphony)

            // End to end, through the real provider: the piece sounded once, whole, in order.
            const unique = new Set(rig.heard)
            expect(unique.size).toBeGreaterThan(400)
            // No omission: crossing the seam skipped nothing.
            expect(unique.size).toBe(new Set(rig.usePiano().getSchedule()!.events
                .filter(e => e.type === 'meta' && e.subtype === 'text')
                .map(e => (e as { text: string }).text)).size)
            // No repeat, bar the one near-simultaneous pair that can straddle a seam.
            expect(rig.heard.length - unique.size).toBeLessThanOrEqual(1)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it('falls back to a restart that seeks, not one that rewinds to the start', async () => {
        // Hardware MIDI output cannot be spliced safely — a note left hanging on someone's
        // instrument is worse than a hiccup — so that path keeps the restart. It must still land
        // where the listener was, which is somewhere else entirely in the new rendering.
        rig = createFakePiano({ canSplice: false })
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ exaggerate: 1 }) })
            act(() => { rig.transport.advanceTo(40) })

            act(() => { setExaggeration!(1.9) })
            act(() => { vi.advanceTimersByTime(500) })

            expect(rig.splices.length).toBe(0)
            expect(rig.played.length).toBe(2)
            // Resumed, not rewound: the same note sits later in the stretched rendering.
            expect(rig.transport.seconds).toBeGreaterThan(40)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it('does nothing while stopped', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { setExaggeration!(1.6) })
            act(() => { vi.advanceTimersByTime(1000) })

            expect(rig.played.length).toBe(0)
            expect(rig.splices.length).toBe(0)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('previewing one gesture', () => {
    /** Well into the piece, so "started here" cannot be confused with "started at the top". */
    const RANGE = { from: 20000, to: 24000 }

    beforeEach(() => {
        rig = createFakePiano()
        play = null
        setExaggeration = null
        vi.spyOn(console, 'log').mockImplementation(() => { })
    })

    /** Where the range sits in the rendering the piano was handed, in seconds. */
    const heard = () => {
        const ids = indexNoteIds(addAbsoluteTime(played()!))
        const span = renderedRange(ids, dateByNoteId, RANGE.from, RANGE.to)!
        return { from: span.fromMs / 1000, to: span.toMs / 1000 }
    }

    it('starts at the gesture rather than at bar 1', async () => {
        const unmount = await mount()

        act(() => { play!({ exaggerate: 1, range: RANGE }) })

        const { from } = heard()
        expect(from).toBeGreaterThan(10)
        expect(rig.transport.seconds).toBeCloseTo(from, 1)

        await unmount()
    })

    it('stops once the gesture is through, instead of playing on to the end', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ exaggerate: 1, range: RANGE }) })

            const { from, to } = heard()
            expect(to - from).toBeGreaterThan(1)
            // Far shorter than the piece, which runs about 160 s.
            expect(to - from).toBeLessThan(40)

            // Still going while the gesture is sounding.
            act(() => { rig.transport.advanceTo(to - 0.5) })
            act(() => { vi.advanceTimersByTime((to - from - 0.5) * 1000) })
            expect(rig.transport.state).toBe('started')

            // And over shortly after it, once the last note has had room to decay.
            act(() => { vi.advanceTimersByTime(2000) })
            expect(rig.transport.state).toBe('stopped')
            expect(rig.piano.held.size).toBe(0)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it('sounds the gesture and stops before the piece runs out', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ mpmIds: [], exaggerate: 1, range: RANGE }) })

            const { from, to } = heard()
            // Play right through the range, then well past where it ends.
            act(() => { rig.transport.advanceTo(to) })
            act(() => { vi.advanceTimersByTime((to - from) * 1000 + 2000) })
            act(() => { rig.transport.advanceTo(to + 60) })

            const dates = rig.heard.map(id => dateByNoteId.get(id)).filter(d => d !== undefined)
            expect(dates.length).toBeGreaterThan(3)
            // Everything sounded belongs to the gesture, bar the tail it is allowed to ring into.
            expect(Math.min(...dates)).toBeGreaterThanOrEqual(RANGE.from)
            expect(dates.filter(d => d >= RANGE.to).length).toBeLessThan(dates.length / 2)

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    it('leaves the whole piece alone when no range is asked for', async () => {
        const unmount = await mount()
        act(() => { play!({ exaggerate: 1 }) })
        expect(rig.transport.seconds).toBe(0)
        await unmount()
    })
})
