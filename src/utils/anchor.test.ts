import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { addAbsoluteTime, emptyState, planSplice, type AbsoluteEvent, type Schedule } from 'react-pianosound'
import { read } from 'midifile-ts'
import { renderPerformance } from './espressivo'
import { readNoteDates } from './score'
import { UNIDENTIFIED_NOTE, indexNoteIds, pickAnchor, renderedRange } from './anchor'

const msm = readFileSync('src/test/fixtures/score.msm', 'utf8')
const mpm = readFileSync('src/test/fixtures/performance.mpm', 'utf8')

const noteOn = (abs: number, noteNumber: number, velocity = 64): AbsoluteEvent =>
    ({ abs, deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 0, noteNumber, velocity } as AbsoluteEvent)

const text = (abs: number, value: string): AbsoluteEvent =>
    ({ abs, deltaTime: 0, type: 'meta', subtype: 'text', text: value } as AbsoluteEvent)

const scheduleOf = (events: readonly AbsoluteEvent[], offset = 0): Schedule =>
    ({ events, offset, from: 0, fromIndex: 0, stateAtFrom: emptyState() })

describe('indexNoteIds', () => {
    it('maps each identified note-on to its absolute ms', () => {
        const index = indexNoteIds([text(0, 'a'), noteOn(0, 60), text(500, 'b'), noteOn(500, 62)])
        expect([...index]).toEqual([['a', 0], ['b', 500]])
    })

    it('leaves out espressivo\'s literal for unlabelled notes', () => {
        expect(indexNoteIds([text(0, UNIDENTIFIED_NOTE), noteOn(0, 60)]).size).toBe(0)
    })

    it('keeps the first occurrence of a repeated id', () => {
        expect(indexNoteIds([text(0, 'a'), text(900, 'a')]).get('a')).toBe(0)
    })
})

describe('pickAnchor', () => {
    const events = [text(0, 'a'), noteOn(0, 60), text(1000, 'b'), noteOn(1000, 62), text(2000, 'c'), noteOn(2000, 64)]
    const incoming = new Map([['a', 0], ['b', 900], ['c', 1700]])

    it('takes the first onset at or after the bound', () => {
        expect(pickAnchor(scheduleOf(events), incoming, 0.5))
            .toEqual({ noteId: 'b', fileMs: 900, transportSeconds: 1 })
    })

    it('names the anchor in both time bases', () => {
        const anchor = pickAnchor(scheduleOf(events), incoming, 1.5)!
        expect(anchor.transportSeconds).toBe(2)   // where it already is
        expect(anchor.fileMs).toBe(1700)          // where it is in the incoming rendering
    })

    it('reads the bound through the outgoing schedule\'s own offset', () => {
        // the same events, laid out 10 s later on the transport
        expect(pickAnchor(scheduleOf(events, 10), incoming, 10.5)?.noteId).toBe('b')
    })

    it('skips ids the incoming rendering has not got', () => {
        expect(pickAnchor(scheduleOf(events), new Map([['c', 1700]]), 0)?.noteId).toBe('c')
    })

    it('returns null past the last shared note, rather than wrapping', () => {
        expect(pickAnchor(scheduleOf(events), incoming, 3)).toBeNull()
    })

    it('agrees with a linear scan at every position', () => {
        for (let t = -1; t <= 3; t += 0.05) {
            const linear = events.find(e =>
                e.type === 'meta' && e.subtype === 'text' &&
                e.abs / 1000 >= t && incoming.has(e.text))
            const picked = pickAnchor(scheduleOf(events), incoming, t)
            expect(picked?.noteId ?? null).toBe(
                linear && linear.type === 'meta' && linear.subtype === 'text' ? linear.text : null)
        }
    })
})

describe('renderedRange', () => {
    // Four notes a second apart, on ticks 0, 720, 1440, 2160.
    const noteIds = new Map([['a', 0], ['b', 1000], ['c', 2000], ['d', 3000]])
    const dates = new Map([['a', 0], ['b', 720], ['c', 1440], ['d', 2160]])

    it('starts at the first note inside the range', () => {
        expect(renderedRange(noteIds, dates, 720, 1441)?.fromMs).toBe(1000)
    })

    it('ends at the next note\'s onset, so the last one is not cut off', () => {
        // The range holds b and c; it is over when d begins.
        expect(renderedRange(noteIds, dates, 720, 1441)).toEqual({ fromMs: 1000, toMs: 3000 })
    })

    it('ends at the last note it covers when there is nothing after it', () => {
        expect(renderedRange(noteIds, dates, 1440, 9999)).toEqual({ fromMs: 2000, toMs: 3000 })
    })

    it('covers a point-like range that has been given width', () => {
        expect(renderedRange(noteIds, dates, 700, 800)).toEqual({ fromMs: 1000, toMs: 2000 })
    })

    it('starts at the note still sounding when the range falls in a gap', () => {
        // Five segments in the corpus are a couple of hundred ticks wide and land between two
        // onsets. The gesture is about the note underneath, not about the silence.
        expect(renderedRange(noteIds, dates, 800, 900)).toEqual({ fromMs: 1000, toMs: 2000 })
    })

    it('says nothing for a range that ends before the first note', () => {
        // Nothing to play, so the caller falls back to the piece whole.
        expect(renderedRange(new Map([['b', 1000]]), dates, 0, 100)).toBeNull()
    })

    it('ignores notes the rendering does not date', () => {
        expect(renderedRange(new Map([...noteIds, ['x', 1]]), dates, 0, 721))
            .toEqual({ fromMs: 0, toMs: 2000 })
    })

})

describe('splicing one rendering into another, over the shipped performance', () => {
    let neutral: AbsoluteEvent[]
    let exaggerated: AbsoluteEvent[]

    beforeAll(() => {
        // espressivo narrates every conversion.
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        neutral = addAbsoluteTime(read(renderPerformance({ msm, mpm, exaggerate: 1 })))
        exaggerated = addAbsoluteTime(read(renderPerformance({ msm, mpm, exaggerate: 2 })))
        log.mockRestore()
    })

    const ids = (events: readonly AbsoluteEvent[]) => events
        .filter(e => e.type === 'meta' && e.subtype === 'text')
        .map(e => (e as { text: string }).text)

    it('renders the very same notes at both ends of the slider', () => {
        // The invariant the whole design rests on: anchoring is by note identity, so the *set* of
        // ids has to survive a transform that stretches the piece by a fifth.
        expect(new Set(ids(exaggerated))).toEqual(new Set(ids(neutral)))
        expect(ids(exaggerated).length).toBe(ids(neutral).length)
        expect(ids(neutral).length).toBeGreaterThan(400)
        expect(new Set(ids(neutral)).size).toBe(ids(neutral).length)
        expect(ids(neutral)).not.toContain(UNIDENTIFIED_NOTE)
    })

    it('reorders only near-simultaneous neighbours', () => {
        // Their *order* is not quite invariant: exaggeration moves notes differentially, so a pair
        // a few milliseconds apart can trade places. That bounds what a seam can disturb — at most
        // one such pair can straddle it, and a re-struck note that is still held is a no-op.
        const before = ids(neutral)
        const after = ids(exaggerated)
        const rank = new Map(after.map((id, i) => [id, i]))

        const absNeutral = new Map(neutral
            .filter(e => e.type === 'meta' && e.subtype === 'text')
            .map(e => [(e as { text: string }).text, e.abs]))

        for (let i = 0; i < before.length; i++) {
            const moved = Math.abs(rank.get(before[i])! - i)
            expect(moved).toBeLessThanOrEqual(1)
            if (moved === 0) continue
            const partner = before[rank.get(before[i])!]
            expect(Math.abs(absNeutral.get(before[i])! - absNeutral.get(partner)!)).toBeLessThan(20)
        }
    })

    it('moves the notes in time even though it does not move their identity', () => {
        const end = (events: readonly AbsoluteEvent[]) => events[events.length - 1].abs
        expect(end(exaggerated)).toBeGreaterThan(end(neutral) * 1.1)
    })

    it('hands over with no repeat, no omission, and no jump backwards', () => {
        const outgoing = scheduleOf(neutral)
        const incoming = indexNoteIds(exaggerated)
        const whole = ids(neutral)
        const continuation = ids(exaggerated)

        for (const nowSeconds of [5, 20, 60, 100, 140]) {
            const anchor = pickAnchor(outgoing, incoming, nowSeconds + 0.02)!
            expect(anchor).toBeTruthy()

            const plan = planSplice(outgoing, exaggerated, anchor, { ppq: 192, bpm: 120, nowSeconds })
            expect(plan.ok).toBe(true)
            if (!plan.ok) return

            // What was heard before the seam, then what the plan will play after it.
            const heard = whole.slice(0, whole.indexOf(anchor.noteId))
            const coming = ids(plan.dispatch)

            // No jump backwards: the continuation is an unbroken tail of the new rendering, picking
            // up exactly where the old one left off — not a restart, not a skip.
            expect(coming).toEqual(continuation.slice(continuation.length - coming.length))

            // No omission: between them the two halves account for every note of the piece.
            expect(new Set([...heard, ...coming])).toEqual(new Set(whole))

            // No repeat: at most the one near-simultaneous pair that can straddle the seam, and a
            // note re-struck while it is still held is a no-op on the sampler.
            const twice = heard.filter(id => coming.includes(id))
            expect(twice.length).toBeLessThanOrEqual(1)
        }
    })

    it('lays the new future out in ascending transport time, starting at the anchor', () => {
        const outgoing = scheduleOf(neutral)
        const anchor = pickAnchor(outgoing, indexNoteIds(exaggerated), 60)!
        const plan = planSplice(outgoing, exaggerated, anchor, { ppq: 192, bpm: 120, nowSeconds: 59 })
        expect(plan.ok).toBe(true)
        if (!plan.ok) return

        expect(plan.times[0]).toBeCloseTo(plan.at, 6)
        for (let i = 1; i < plan.times.length; i++) {
            expect(plan.times[i]).toBeGreaterThanOrEqual(plan.times[i - 1])
        }
    })

    it('releases the few notes the incoming rendering has already let go, and no more', () => {
        const outgoing = scheduleOf(neutral)
        const incoming = indexNoteIds(exaggerated)
        for (const nowSeconds of [10, 30, 50, 70, 90, 110, 130]) {
            const anchor = pickAnchor(outgoing, incoming, nowSeconds + 0.02)!
            const plan = planSplice(outgoing, exaggerated, anchor, { ppq: 192, bpm: 120, nowSeconds })
            if (!plan.ok) continue
            // A handful means the anchor is landing on an onset and the timelines agree locally.
            expect(plan.released.length).toBeLessThan(8)
            expect(plan.attacked.length).toBeLessThan(8)
        }
    })

    it('schedules far fewer events than the rendering carries, by collapsing the pedal', () => {
        const outgoing = scheduleOf(neutral)
        const anchor = pickAnchor(outgoing, indexNoteIds(exaggerated), 0.02)!
        const plan = planSplice(outgoing, exaggerated, anchor, { ppq: 192, bpm: 120, nowSeconds: 0 })
        expect(plan.ok).toBe(true)
        if (!plan.ok) return
        expect(exaggerated.length).toBeGreaterThan(5000)
        expect(plan.dispatch.length).toBeLessThan(exaggerated.length / 3)
    })

    it('refuses a splice the playhead has already passed, before touching anything', () => {
        const outgoing = scheduleOf(neutral)
        const anchor = pickAnchor(outgoing, indexNoteIds(exaggerated), 10)!
        const plan = planSplice(outgoing, exaggerated, anchor, { ppq: 192, bpm: 120, nowSeconds: 20 })
        expect(plan.ok).toBe(false)
        if (!plan.ok) expect(plan.reason).toBe('stale')
    })

    it('locates a gesture by its ticks, and finds it moved once the piece is stretched', () => {
        const dateByNoteId = readNoteDates(msm)
        expect(dateByNoteId.size).toBeGreaterThan(400)

        const at1 = renderedRange(indexNoteIds(neutral), dateByNoteId, 20000, 24000)!
        const at2 = renderedRange(indexNoteIds(exaggerated), dateByNoteId, 20000, 24000)!

        // Well into the piece, and a few seconds long — one gesture, not the whole thing.
        expect(at1.fromMs).toBeGreaterThan(10_000)
        expect(at1.toMs - at1.fromMs).toBeGreaterThan(1000)
        expect(at1.toMs - at1.fromMs).toBeLessThan(60_000)

        // The same ticks, later and longer in the stretched rendering: which is why the range is
        // re-read from whatever is playing rather than remembered as a time.
        expect(at2.fromMs).toBeGreaterThan(at1.fromMs)
        expect(at2.toMs - at2.fromMs).toBeGreaterThan(at1.toMs - at1.fromMs)
    })

    it('refuses an anchor behind the schedule it would replace', () => {
        const outgoing: Schedule = { ...scheduleOf(neutral), from: 100 }
        const anchor = pickAnchor(scheduleOf(neutral), indexNoteIds(exaggerated), 50)!
        const plan = planSplice(outgoing, exaggerated, anchor, { ppq: 192, bpm: 120, nowSeconds: 10 })
        expect(plan.ok).toBe(false)
        if (!plan.ok) expect(plan.reason).toBe('backwards')
    })
})
