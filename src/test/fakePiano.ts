/**
 * A transport and a sampler faithful enough to catch the mistakes that matter.
 *
 * jsdom has no Web Audio graph, so playback cannot be tested against the real thing. The two
 * properties worth reproducing exactly are the ones a hand-waved fake gets wrong:
 *
 *  - a tick, once passed, is never revisited — so a splice that lands too late goes *silent*
 *    rather than glitching, and the test fails instead of the product;
 *  - the sampler is idempotent: `keyDown` on a held note and `keyUp` on an unheld one do nothing,
 *    and pedal-sustained notes are released only by `pedalUp`. Reconciliation leans on all three.
 */
import { addAbsoluteTime, planSplice, toneRelevant, type AbsoluteEvent, type Schedule } from 'react-pianosound'
import type { AnyEvent, ControllerEvent, MidiFile, NoteOffEvent, NoteOnEvent } from 'midifile-ts'

interface Scheduled {
    id: number
    tick: number
    seq: number
    cb: (time: number) => void
}

class FakeTransport {
    PPQ = 192
    bpm = { value: 120 }
    state: 'started' | 'stopped' = 'stopped'

    private scheduled: Scheduled[] = []
    private nextId = 0
    private seq = 0
    /** Everything up to here has been dispatched. Tone never looks back past it. */
    private frontierTick = -1

    get tps() { return (this.PPQ * this.bpm.value) / 60 }

    /** Tone reports the dispatch frontier, which runs ahead of what you can hear. */
    get seconds() { return Math.max(0, this.frontierTick) / this.tps }

    schedule(cb: (time: number) => void, time: number): number {
        const event = { id: this.nextId++, tick: Math.floor(time * this.tps), seq: this.seq++, cb }
        this.scheduled.push(event)
        return event.id
    }

    cancel(after = 0): void {
        const boundary = after * this.tps
        this.scheduled = this.scheduled.filter(e => e.tick < boundary)
    }

    start() { this.state = 'started' }

    stop() {
        this.state = 'stopped'
        this.scheduled = []
        this.frontierTick = -1
    }

    set position(_value: number) { this.frontierTick = -1 }
    set seconds(value: number) { this.frontierTick = Math.floor(value * this.tps) }

    /** Advance the playhead, firing everything newly due, in tick then insertion order. */
    advanceTo(second: number): void {
        const target = Math.floor(second * this.tps)
        const due = this.scheduled
            .filter(e => e.tick > this.frontierTick && e.tick <= target)
            .sort((a, b) => a.tick - b.tick || a.seq - b.seq)
        this.frontierTick = target
        for (const event of due) event.cb(event.tick / this.tps)
    }

    get pending() { return this.scheduled.length }
}

interface PianoAction { type: 'keyDown' | 'keyUp' | 'pedalDown' | 'pedalUp'; midi?: number; time: number }

class FakePiano {
    loaded = true
    maxPolyphony = 128
    readonly held = new Map<number, number>()
    readonly sustained = new Set<number>()
    pedalIsDown = false
    readonly actions: PianoAction[] = []
    /** Notes the polyphony budget refused — @tonejs/piano drops these silently. */
    dropped = 0
    maxVoices = 0

    toDestination() { return this }

    private countVoices() {
        this.maxVoices = Math.max(this.maxVoices, this.held.size + this.sustained.size)
    }

    keyDown({ midi, velocity, time = 0 }: { midi: number; velocity?: number; time?: number }) {
        if (this.held.has(midi)) return this
        if (this.held.size + this.sustained.size >= this.maxPolyphony) { this.dropped++; return this }
        this.sustained.delete(midi)
        this.held.set(midi, velocity ?? 0)
        this.countVoices()
        this.actions.push({ type: 'keyDown', midi, time })
        return this
    }

    keyUp({ midi, time = 0 }: { midi: number; time?: number }) {
        if (!this.held.has(midi)) return this
        this.held.delete(midi)
        if (this.pedalIsDown) this.sustained.add(midi)
        else this.actions.push({ type: 'keyUp', midi, time })
        this.countVoices()
        return this
    }

    pedalDown({ time = 0 }: { time?: number } = {}) {
        if (this.pedalIsDown) return this
        this.pedalIsDown = true
        this.actions.push({ type: 'pedalDown', time })
        return this
    }

    pedalUp({ time = 0 }: { time?: number } = {}) {
        if (!this.pedalIsDown) return this
        this.pedalIsDown = false
        for (const midi of this.sustained) this.actions.push({ type: 'keyUp', midi, time })
        this.sustained.clear()
        this.actions.push({ type: 'pedalUp', time })
        return this
    }

    stopAll() {
        this.pedalUp({})
        for (const midi of [...this.held.keys()]) this.keyUp({ midi })
        return this
    }
}

const isNoteOn = (e: AnyEvent): e is NoteOnEvent =>
    e.type === 'channel' && e.subtype === 'noteOn' && (e.velocity ?? 0) > 0
const isNoteOff = (e: AnyEvent): e is NoteOffEvent | NoteOnEvent =>
    e.type === 'channel' && (e.subtype === 'noteOff' || (e.subtype === 'noteOn' && (e.velocity ?? 0) === 0))
const isPedal = (e: AnyEvent): e is ControllerEvent =>
    e.type === 'channel' && e.subtype === 'controller' && e.controllerType === 64

/** The whole rig: a transport, a sampler, and a `usePiano` that drives them the way the real one does. */
export const createFakePiano = ({ canSplice = true }: { canSplice?: boolean } = {}) => {
    const transport = new FakeTransport()
    const piano = new FakePiano()
    let installed: Schedule | null = null
    /** Every rendering handed to play(), in order — what the existing contract tests inspect. */
    const played: MidiFile[] = []
    const splices: { at: number; released: number[]; attacked: number[] }[] = []
    /** Every note id that actually reached the sink, in the order it sounded. */
    const heard: string[] = []

    const dispatcher = (event: AbsoluteEvent, cb?: (e: AnyEvent) => void) => (time: number) => {
        cb?.(event)
        if (event.type === 'meta' && event.subtype === 'text') heard.push(event.text)
        if (isNoteOn(event)) piano.keyDown({ midi: event.noteNumber, velocity: event.velocity, time })
        else if (isNoteOff(event)) piano.keyUp({ midi: event.noteNumber, time })
        else if (isPedal(event)) {
            if ((event.value ?? 0) > 63) piano.pedalDown({ time }); else piano.pedalUp({ time })
        }
    }

    const usePiano = () => ({
        status: 'done' as const,
        device: 'synthetic',
        canSplice,
        play: (file: MidiFile, cb?: (e: AnyEvent) => void): Schedule | null => {
            played.push(file)
            const events = addAbsoluteTime(file)
            transport.stop()
            for (const event of toneRelevant(events)) {
                transport.schedule(dispatcher(event, cb), event.abs / 1000)
            }
            transport.start()
            installed = { events, offset: 0, from: 0, fromIndex: 0, stateAtFrom: { notes: new Map(), controllers: new Map() } }
            return installed
        },
        stop: () => { transport.stop(); piano.stopAll(); installed = null },
        jumpTo: (seconds: number) => { transport.seconds = seconds },
        playSingleNote: () => { },
        getTransportSeconds: () => transport.seconds,
        getSchedule: () => installed,
        splice: ({ events, anchor, cb }: { events?: readonly AbsoluteEvent[]; anchor: { fileMs: number; transportSeconds: number }; cb?: (e: AnyEvent) => void }) => {
            if (!installed) return { ok: false as const, reason: 'no-schedule' as const }
            const plan = planSplice(installed, events!, anchor, {
                ppq: transport.PPQ, bpm: transport.bpm.value, nowSeconds: transport.seconds,
            })
            if (!plan.ok) return plan
            transport.cancel(plan.cancelAt)
            transport.schedule((time) => {
                if (plan.sustainDown) piano.pedalDown({ time }); else piano.pedalUp({ time })
                for (const midi of plan.released) piano.keyUp({ midi, time })
                for (const [midi, velocity] of plan.attacked) piano.keyDown({ midi, velocity, time })
            }, plan.at)
            for (let i = 0; i < plan.dispatch.length; i++) {
                transport.schedule(dispatcher(plan.dispatch[i], cb), plan.times[i])
            }
            installed = plan.next
            splices.push({ at: plan.at, released: plan.released, attacked: plan.attacked.map(([m]) => m) })
            return {
                ok: true as const, schedule: plan.next, at: plan.at, offset: plan.offset,
                scheduled: plan.dispatch.length, released: plan.released,
                attacked: plan.attacked.map(([m]) => m), sustainDown: plan.sustainDown, costMs: 0,
            }
        },
    })

    return { transport, piano, usePiano, played, splices, heard }
}
