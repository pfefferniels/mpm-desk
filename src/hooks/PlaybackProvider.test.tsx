/**
 * Playback renders on the caller's thread, over the files the app actually ships.
 *
 * The point is the contract: `play()` returns with the piano already holding a parsed MIDI file,
 * and that file carries one text meta event per note-on naming the note — which is how the editor
 * follows the playhead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { act, useEffect } from 'react'
import type { MidiFile } from 'midifile-ts'
import { addAbsoluteTime } from 'react-pianosound'
import { createFakePiano } from '../test/fakePiano'
import { readNoteDates } from '../utils/score'
import { ZoomContext } from './ZoomProvider'
import { EditingContext } from './Editing'
import { PlaybackProvider, usePlayback } from './PlaybackProvider'

// The piano wants a Web Audio graph jsdom has not got. The
// rig underneath is faithful about the two things that matter — a passed tick never fires again,
// and the sampler is idempotent — so the splice logic is genuinely exercised, not stubbed out.
let rig = createFakePiano()

type RigPiano = ReturnType<typeof rig.usePiano>

/**
 * Whether the samples are still coming, and the presses waiting for them: the contract
 * `performance/piano` keeps, played out here so that the rig can stand behind it. While they are
 * coming the piano refuses, as the real one does.
 */
const samples = { loading: false, waiting: new Set<(piano: RigPiano) => void>() }

vi.mock('../performance/piano', async (importOriginal) => ({
    ...await importOriginal<typeof import('../performance/piano')>(),
    usePiano: () => samples.loading
        ? { ...rig.usePiano(), status: 'loading', play: () => null }
        : rig.usePiano(),
    whenSamplesArrive: (start: (piano: RigPiano) => void) => {
        if (!samples.loading) return null
        samples.waiting.add(start)
        return () => { samples.waiting.delete(start) }
    },
}))

const samplesArrive = () => {
    samples.loading = false
    const starts = [...samples.waiting]
    samples.waiting.clear()
    for (const start of starts) start(rig.usePiano())
}

const played = () => rig.played[rig.played.length - 1] ?? null

const scoreMsm = readFileSync('src/test/fixtures/score.msm', 'utf-8')
const performanceMpm = readFileSync('src/test/fixtures/performance.mpm', 'utf-8')
const dateByNoteId = readNoteDates(scoreMsm)

let play: ReturnType<typeof usePlayback>['play'] | null = null
let stop: ReturnType<typeof usePlayback>['stop'] | null = null
let setExaggeration: ReturnType<typeof usePlayback>['setExaggeration'] | null = null
/** What the transport button reads to decide between Play and Stop. */
let isPlaying = false
let isPending = false

const Capture = () => {
    const playback = usePlayback()
    useEffect(() => { play = playback.play }, [playback.play])
    useEffect(() => { stop = playback.stop }, [playback.stop])
    useEffect(() => { setExaggeration = playback.setExaggeration }, [playback.setExaggeration])
    useEffect(() => { isPlaying = playback.isPlaying }, [playback.isPlaying])
    useEffect(() => { isPending = playback.isPending }, [playback.isPending])
    return null
}

/** Mounted at a zoom wide enough that it changes nothing, in the editor unless said otherwise. */
const mount = async ({ stretchX = 20, editable = true }: { stretchX?: number; editable?: boolean } = {}) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(
            <EditingContext value={editable}>
                <ZoomContext value={{ symbolic: { stretchX }, physical: { stretchX }, setStretchX: () => { } }}>
                    <PlaybackProvider scoreMsm={scoreMsm} performanceMpm={performanceMpm} dateByNoteId={dateByNoteId}>
                        <Capture />
                    </PlaybackProvider>
                </ZoomContext>
            </EditingContext>
        )
    })
    return async () => { await act(async () => root.unmount()); container.remove() }
}

const noteIds = (file: MidiFile) => file.tracks
    .flat()
    .filter(event => event.type === 'meta' && event.subtype === 'text')
    .map(event => (event as { text: string }).text)

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

    it('reports itself stopped once the piece has run out', async () => {
        vi.useFakeTimers()
        try {
            const unmount = await mount()
            act(() => { play!({ exaggerate: 1 }) })
            expect(isPlaying).toBe(true)

            const end = rig.usePiano().getSchedule()!.events.at(-1)!.abs / 1000
            expect(end).toBeGreaterThan(100)

            // Still going a second before the last event.
            act(() => { rig.transport.advanceTo(end - 1) })
            act(() => { vi.advanceTimersByTime((end - 1) * 1000) })
            expect(isPlaying).toBe(true)

            // And over once the final chord has had room to decay.
            act(() => { rig.transport.advanceTo(end) })
            act(() => { vi.advanceTimersByTime(2000) })
            expect(isPlaying).toBe(false)
            expect(rig.transport.state).toBe('stopped')

            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

})

describe('the zoom', () => {
    beforeEach(() => {
        rig = createFakePiano()
        play = null
        vi.spyOn(console, 'log').mockImplementation(() => { })
    })

    /** When each note sounds in what play() hands the piano, mounted as given. */
    const onsetsPlayed = async (options: { stretchX: number; editable: boolean }) => {
        const unmount = await mount(options)
        act(() => { play!() })
        const onsets = addAbsoluteTime(played()!)
            .filter(event => event.type === 'meta' && event.subtype === 'text')
            .map(event => event.abs)
        await unmount()
        return onsets
    }

    // Zoomed out to 2, the editor's sketchiness would be 1.32: the viewer has nothing on screen
    // that says so, and a reader there has to hear the reconstruction as it was published.
    it('leaves what the viewer plays as published', async () => {
        const wide = await onsetsPlayed({ stretchX: 20, editable: false })
        const zoomedOut = await onsetsPlayed({ stretchX: 2, editable: false })

        expect(zoomedOut).toEqual(wide)
    })

    it('still loosens what the editor plays', async () => {
        const wide = await onsetsPlayed({ stretchX: 20, editable: true })
        const zoomedOut = await onsetsPlayed({ stretchX: 2, editable: true })

        expect(zoomedOut).toHaveLength(wide.length)
        expect(zoomedOut).not.toEqual(wide)
    })
})

describe('a press of play made while the samples are still coming', () => {
    beforeEach(() => {
        rig = createFakePiano()
        play = null
        stop = null
        samples.loading = true
        samples.waiting.clear()
        vi.spyOn(console, 'log').mockImplementation(() => { })
    })

    afterEach(() => {
        samples.loading = false
    })

    // The first press on a visit is what sends for the samples. It used to be refused like any
    // other made while they loaded, and hearing anything took a second press.
    it('waits for them, and then starts by itself', async () => {
        const unmount = await mount()
        act(() => { play!() })

        expect(rig.played).toHaveLength(0)
        expect(isPlaying).toBe(false)
        expect(isPending).toBe(true)

        act(() => { samplesArrive() })

        expect(rig.played).toHaveLength(1)
        expect(isPlaying).toBe(true)
        expect(isPending).toBe(false)

        await unmount()
    })

    it('never starts once stopped meanwhile', async () => {
        const unmount = await mount()
        act(() => { play!() })
        act(() => { stop!() })
        expect(isPending).toBe(false)

        act(() => { samplesArrive() })

        expect(rig.played).toHaveLength(0)
        expect(isPlaying).toBe(false)

        await unmount()
    })

    it('starts once, however often it was pressed', async () => {
        const unmount = await mount()
        act(() => { play!() })
        act(() => { play!() })

        act(() => { samplesArrive() })

        expect(rig.played).toHaveLength(1)

        await unmount()
    })

    it('never starts once the provider has gone', async () => {
        const unmount = await mount()
        act(() => { play!() })
        await unmount()

        act(() => { samplesArrive() })

        expect(rig.played).toHaveLength(0)
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
