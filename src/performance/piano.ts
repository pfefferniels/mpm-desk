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
 *
 * It is also what starts the download. Nothing is fetched until something asks to be heard, and
 * most visits to the viewer never do: the first play or audition is refused like any other made
 * while the samples are coming, and is what sets them coming, since `PianoProvider` mounts the
 * piano once this says sound is wanted. A transport's press then starts by itself when they are
 * here, through `whenSamplesArrive`; an audition's is simply lost.
 */

import { useMemo, useSyncExternalStore } from 'react'
import type { usePiano as usePianoSound } from 'react-pianosound'

/** Velocity layers to load: what `PianoProvider` mounts the piano with, and the count below. */
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

export type Piano = ReturnType<typeof usePianoSound>

/**
 * Whether anything has asked to be heard yet.
 *
 * The download waits for this. While the piano was mounted at the root, every visit fetched the
 * 16 MB on arrival, before anyone had pressed Play or passed over anything that sounds.
 */
let wanted = false

/** The piano `PianoProvider` mounted, as the library's own hook last handed it over. */
let mounted: Piano | null = null

/** The presses waiting for the samples, each to be started with the piano once they are here. */
const arrivals = new Set<(piano: Piano) => void>()

/** Send for the samples: the first asking mounts the piano, and mounting starts the download. */
const want = () => {
    if (wanted) return
    wanted = true
    announce()
}

/** Whether the piano should be mounted, which is what `PianoProvider` watches. */
export const useSoundWanted = (): boolean =>
    useSyncExternalStore(subscribe, () => wanted, () => false)

/**
 * Hand over what the library's `usePiano` returned, or `null` once the piano is gone.
 *
 * After every render of the component holding that hook rather than once, because it hands back a
 * new object each time and that object's `play` closes over the piano and status of its render.
 */
export const publishPiano = (piano: Piano | null) => {
    mounted = piano
    announce()
    if (piano?.status !== 'done' || arrivals.size === 0) return
    const starts = [...arrivals]
    arrivals.clear()
    for (const start of starts) start(piano)
}

/**
 * Start a refused press once the samples are here, with the piano that can sound it. Returns what
 * cancels it, or `null` when the samples are not on their way and there is nothing to wait for.
 *
 * For a transport. Without it, the first press of Play on a visit only sent for the samples, and a
 * listener had to find out by waiting that it took a second press to hear anything. The press is
 * the transport's to cancel, by Stop, by another press, or by going away, since only the transport
 * knows what of it still holds: a pending press must not start on a document it was not made for.
 *
 * Not for an audition. A note that sounds seconds after the pointer has left what it belongs to
 * says nothing about that, so a hover or click that was refused is refused for good.
 *
 * The piano comes as an argument because the transport's own copy is a render old. It was handed
 * out while the samples were still loading, and it refuses.
 */
export const whenSamplesArrive = (start: (piano: Piano) => void): (() => void) | null => {
    const status = mounted?.status ?? (wanted ? 'loading' : undefined)
    if (status !== 'loading') return null
    arrivals.add(start)
    return () => {
        arrivals.delete(start)
    }
}

interface SampleLoading {
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
    const { status } = useMounted()
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

/**
 * What a transport says instead of naming its shortcut, while the samples are the reason. With
 * `pending`, that a press is waiting for them and starts by itself when they are here.
 */
export const sampleLoadingHint = ({ failed, percent }: SampleLoading, pending = false) =>
    failed
        ? 'The piano samples could not be loaded'
        : `Loading piano samples — ${String(percent)}%${pending ? ', then playing' : ''}`

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

/**
 * The piano before there is one.
 *
 * Every play is refused, and is what sends for the samples. Refused rather than kept here for
 * later, because whether a press should still sound once they are here is the caller's to say: a
 * transport says so through `whenSamplesArrive`, and an audition does not. The notice says why
 * nothing was heard, and the transport shows the download meanwhile.
 */
const silent: Piano = {
    status: undefined,
    play: () => {
        want()
        return refusePlay()
    },
    playSingleNote: () => {
        want()
        refuseNote()
    },
    stop: () => {},
    jumpTo: () => {},
    splice: () => ({ ok: false, reason: 'not-loaded' }),
    getTransportSeconds: () => 0,
    getSchedule: () => null,
    canSplice: false,
    device: 'synthetic',
}

/**
 * The piano there is, or `silent`, and what to make of its status.
 *
 * A piano that has said nothing yet is loading once sound has been asked for: it is on its way,
 * mounting or mounted and not yet through the effect that starts its download. Before that,
 * nothing is coming and nothing is missing, so the status stays `undefined` and a play goes
 * through to `silent`, which asks.
 */
const useMounted = (): { piano: Piano; status: Piano['status'] } => {
    const piano = useSyncExternalStore(subscribe, () => mounted, () => null) ?? silent
    const asked = useSoundWanted()
    return { piano, status: piano.status ?? (asked ? 'loading' : undefined) }
}

/**
 * The piano, refusing to pretend.
 *
 * Only a piano that is loading or has failed is gated. `undefined` passes through, which is the
 * piano before anything has asked for one: the question here is whether the samples are known to
 * be missing, not whether they are known to be there.
 *
 * Safe without a `PianoProvider` above, as in a test that mounts a desk on its own: the piano
 * there is `silent`, and simply never arrives.
 */
export const usePiano = (): Piano => {
    const { piano, status } = useMounted()
    if (status !== 'loading' && status !== 'error') return piano
    return { ...piano, status, play: refusePlay, playSingleNote: refuseNote }
}
