/**
 * The piano, and the wait for it.
 *
 * `@tonejs/piano` fetches one audio file per sampled note from another host before it can sound
 * anything, which on a cold visit is several seconds and some 16 MB. Until that is through,
 * `keyDown` drops every note and only warns on the console — so pressing play started the
 * transport, moved the button to Stop and produced silence, and clicking a chip to audition a
 * gesture did nothing at all.
 *
 * This module is the one door to the piano. It refuses a play the samples cannot serve, counts
 * how far the download has got so a control can show it, and records the refusal so something on
 * screen can say why nothing was heard. Import `usePiano` from here rather than from
 * `react-pianosound`, or a play goes through ungated.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { usePiano as usePianoSound } from 'react-pianosound'

/** Velocity layers to load. Both trees mount `PianoContextProvider` with this. */
export const PIANO_VELOCITIES = 3

/** Where `@tonejs/piano` fetches its samples from — its own default `url`. */
const SAMPLE_URL = 'https://tambien.github.io/Piano/audio/'

/**
 * How many files that comes to.
 *
 * The Salamander set holds every third semitone from A0 to C8, which is 30 notes, and one file per
 * note per velocity layer; the pedal adds its two down and two up noises. The release layer —
 * keyclick and string harmonic, another 111 files — is off in `@tonejs/piano`'s defaults and
 * nothing here turns it on.
 *
 * A count, rather than bytes: a cross-origin host that sends no `Timing-Allow-Origin` reports
 * every transfer as zero bytes, and `tambien.github.io` is such a host.
 */
const SAMPLED_NOTES = 30
const PEDAL_SAMPLES = 4
const TOTAL_SAMPLES = SAMPLED_NOTES * PIANO_VELOCITIES + PEDAL_SAMPLES

const arrived = new Set<string>()
let refusals = 0

const listeners = new Set<() => void>()
const announce = () => listeners.forEach((listener) => listener())

let observer: PerformanceObserver | null = null

/**
 * Count the samples as they land.
 *
 * A `PerformanceObserver` and not `getEntriesByType`, because the resource timing buffer holds 250
 * entries by default and 94 samples on top of the app's own files can fill it — once it is full the
 * dropped entries are invisible to a reader, while an observer still hears every one. `buffered`
 * hands over the samples that arrived before anything on screen asked.
 */
const watchSamples = () => {
    const supported = typeof PerformanceObserver === 'function'
        && (PerformanceObserver.supportedEntryTypes ?? []).includes('resource')
    if (observer || !supported) return

    observer = new PerformanceObserver((list) => {
        const before = arrived.size
        for (const entry of list.getEntries()) {
            if (entry.name.startsWith(SAMPLE_URL)) arrived.add(entry.name)
        }
        if (arrived.size === before) return
        if (arrived.size >= TOTAL_SAMPLES) {
            observer?.disconnect()
            observer = null
        }
        announce()
    })
    observer.observe({ type: 'resource', buffered: true })
}

const subscribe = (listener: () => void) => {
    watchSamples()
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export interface SampleLoading {
    /** Still fetching, so nothing will sound yet */
    loading: boolean
    /** The samples could not be fetched at all */
    failed: boolean
    /** Samples that have arrived, out of the whole set */
    loaded: number
    total: number
    /** How far along the download is, 0 to 1 */
    progress: number
    /** The same as a whole percent, which is what a control has room to say */
    percent: number
}

/** How far the piano has got with its samples. */
export const useSampleLoading = (): SampleLoading => {
    const { status } = usePianoSound()
    const loaded = useSyncExternalStore(subscribe, () => arrived.size, () => 0)

    return useMemo(() => {
        // The piano reports `done` on its own promise, which is the authority on being finished;
        // the count only says how far along an unfinished download is.
        const progress = status === 'done' ? 1 : Math.min(loaded / TOTAL_SAMPLES, 1)
        return {
            loading: status === 'loading',
            failed: status === 'error',
            loaded: status === 'done' ? TOTAL_SAMPLES : Math.min(loaded, TOTAL_SAMPLES),
            total: TOTAL_SAMPLES,
            progress,
            percent: Math.round(progress * 100),
        }
    }, [status, loaded])
}

/** What a transport says instead of naming its shortcut, while the samples are the reason. */
export const sampleLoadingHint = ({ failed, percent }: SampleLoading) =>
    failed
        ? 'The piano samples could not be loaded'
        : `Loading piano samples — ${String(percent)}%`

/**
 * How many plays have been refused for want of samples.
 *
 * What the notice watches. A count rather than a flag: two presses of play while the samples are
 * still coming are two separate askings, and the second has to re-open a notice the first one's
 * was dismissed from.
 */
export const useRefusedPlays = (): number =>
    useSyncExternalStore(subscribe, () => refusals, () => 0)

const refuse = () => {
    refusals += 1
    announce()
}

const refusePlay = () => {
    refuse()
    return null
}

const refuseNote = () => {
    refuse()
}

type Piano = ReturnType<typeof usePianoSound>

/**
 * The piano, refusing to pretend.
 *
 * Only a piano that says it is loading or has failed is gated. `undefined` — the instant before
 * the provider's effect has run, and what a test's stub reports — passes through, because the
 * question here is whether the samples are known to be missing, not whether they are known to be
 * there.
 */
export const usePiano = (): Piano => {
    const piano = usePianoSound()
    if (piano.status !== 'loading' && piano.status !== 'error') return piano
    return { ...piano, play: refusePlay, playSingleNote: refuseNote }
}
