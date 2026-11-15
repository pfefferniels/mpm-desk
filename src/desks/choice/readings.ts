import { rowId, type AlignedNote, type AlignedPedal, type Alignment } from "../../fitting/alignment"
import { isCallOf } from "../../fitting/calls"
import type { MakeChoiceOptions } from "../../fitting/transformers/choice/MakeChoice"
import type { Call } from "../../model/Work"
import { callAddress } from "../../model/callAddress"

/** Every reading of the score, note by note and press by press. */
interface Readings {
    notes: AlignedNote[]
    pedals: AlignedPedal[]
}

/**
 * How far the chain moved the recording's zero, in milliseconds.
 *
 * The middle of what separates each row's recorded onset from the onset the chain left it at.
 * `InsertTempo` takes the leader before the first note off every event alike; a correction, an
 * expansion or a collapsed arpeggio moves a few further, and a few do not move the middle. Zero
 * where nothing has shifted the recording, as before a tempo has been drawn.
 */
const zeroShiftMs = (recorded: Alignment, fitted: Alignment): number => {
    const onsets = new Map(recorded.allNotes.map(note => [rowId(note), note['milliseconds.date']]))
    const shifts = fitted.allNotes
        .map(note => (onsets.get(rowId(note)) ?? NaN) - note['milliseconds.date'])
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
    return shifts[Math.floor(shifts.length / 2)] ?? 0
}

/**
 * The readings as they were recorded, on the time axis the chain left the recording on.
 *
 * From the alignment as loaded, because the fitted one keeps only what `MakeChoice` took: once a
 * choice has been made for the piece every note there has one row, and the desk whose subject is
 * the readings showed one of them, with nothing to say that it had been chosen or over what.
 *
 * The recorded values rather than the corrected ones, too. The choice runs before every
 * correction, so these are what it chose between, and a velocity an expansion had stretched on the
 * kept reading alone would read as a difference the takes never had.
 *
 * Moved, though, by what the chain moved every event by. The other desks, the scroll they share
 * and a call revealed by its range all place the recording where the chain left it, which once a
 * tempo is drawn counts from the first note rather than from the start of the roll. A pedal down
 * before the first note starts at zero, as `shiftToFirstOnset` puts it.
 */
export const readingsOnFittedAxis = (recorded: Alignment, fitted: Alignment): Readings => {
    const shift = zeroShiftMs(recorded, fitted)
    return {
        notes: recorded.allNotes.map(note => ({
            ...note,
            'milliseconds.date': note['milliseconds.date'] - shift,
            'milliseconds.date.end': note['milliseconds.date.end'] - shift,
        })),
        pedals: recorded.pedals.map(pedal => ({
            ...pedal,
            'milliseconds.date': Math.max(0, pedal['milliseconds.date'] - shift),
            'milliseconds.date.end': pedal['milliseconds.date.end'] - shift,
        })),
    }
}

/**
 * The reading the chain went on with for each score note, by `xml:id`: the `@source` of the one
 * row the fitted alignment still holds of it.
 *
 * Read off what the chain did rather than worked out from the calls. Which call decides a note is
 * not simply the one whose scope names it: the first choice to reach a note settles it, and a later
 * one preferring another reading there finds nothing of that reading left and passes over it.
 *
 * A note the chain still holds several rows of is absent, since nothing has been taken for it yet.
 * One it holds no row of at all maps to `null`: `MakeChoice` takes notes that share a date, a
 * length and a pitch for one, so of a unison between two parts it keeps a single note.
 */
export const takenNotes = (recorded: Alignment, fitted: Alignment): Map<string, string | null> => {
    const kept = Map.groupBy(fitted.allNotes, note => note['xml:id'])
    const taken = new Map<string, string | null>()
    for (const id of new Set(recorded.allNotes.map(note => note['xml:id']))) {
        const rows = kept.get(id)
        if (!rows) taken.set(id, null)
        else if (rows.length === 1) taken.set(id, rows[0].source ?? null)
    }
    return taken
}

/**
 * The readings whose pedalling the chain kept, or undefined where it kept every one.
 *
 * `MakeChoice` takes the pedals of one reading for the whole piece, whatever the scope of the call,
 * so this is said per reading rather than per press.
 */
export const takenPedalling = (recorded: Alignment, fitted: Alignment): ReadonlySet<string> | undefined => {
    const sourcesOf = (pedals: readonly AlignedPedal[]) =>
        new Set(pedals.flatMap(pedal => (pedal.source ? [pedal.source] : [])))
    const before = sourcesOf(recorded.pedals)
    const after = sourcesOf(fitted.pedals)
    return after.size < before.size ? after : undefined
}

/**
 * A reading's name on screen.
 *
 * Neither the `<recording>` nor the `<manifestation>` its `@source` points at carries a label:
 * the alignment desk writes none, and the published roll's two describe their capture in the same
 * words. So the `@source` is the name, and since a roll scan's is a UUID, it is cut as a call's
 * address is cut, as short as it can be while it still names one reading.
 */
export const readingName = (source: string, readings: readonly string[]): string =>
    callAddress(source, readings)

/** What of a reading a `MakeChoice` can take, as its dialog asks for them. */
type Aspect = 'loudness' | 'timing' | 'pedalling'

/** One reading a `MakeChoice` call prefers, and over what. */
export interface Preferred {
    /** The call, so the reader can select it from where it is named. */
    call: string
    source: string
    /** What it takes from the reading, or undefined where it takes all of it. */
    aspects?: readonly Aspect[]
    /** What it covers, in words: the whole piece, a stretch of ticks, or a count of notes. */
    scope: string
}

/**
 * What every `MakeChoice` in the chain prefers, reading by reading, in the order of the calls.
 *
 * A choice that splits its preference — loudness from one take, timing and pedalling from another
 * — prefers each of the two for part of what it takes.
 */
export const preferencesOf = (calls: readonly Call[]): Preferred[] =>
    calls.filter(isCallOf('MakeChoice')).flatMap((call): Preferred[] => {
        // Held as the transformer's own union: still intersected with the file's open record,
        // `in` cannot tell its arms apart.
        const { id } = call
        const options: MakeChoiceOptions = call.options
        const scope = 'from' in options
            ? `ticks ${options.from}–${options.to}`
            : 'noteIDs' in options
                ? `${options.noteIDs.length} ${options.noteIDs.length === 1 ? 'note' : 'notes'}`
                : 'the whole piece'

        if ('prefer' in options) {
            return options.prefer ? [{ call: id, source: options.prefer, scope }] : []
        }

        const taking: [Aspect, string][] = [
            ['loudness', options.velocity],
            ['timing', options.timing],
            ['pedalling', options.pedalling],
        ]
        const bySource = Map.groupBy(taking.filter(([, source]) => source), ([, source]) => source)
        return [...bySource].map(([source, aspects]) => ({
            call: id,
            source,
            aspects: aspects.length === taking.length ? undefined : aspects.map(([aspect]) => aspect),
            scope,
        }))
    })
