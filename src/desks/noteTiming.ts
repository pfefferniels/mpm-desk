import type { AlignedNote, AlignedPedal } from '../fitting/alignment';

/**
 * When the recording sounded a note, in **seconds** — the unit every desk draws in.
 *
 * ## Why this module exists
 *
 * MSM states a performance in milliseconds, so the alignment holds them: `milliseconds.date` and
 * `milliseconds.date.end` are **milliseconds**, and the second is an absolute **end**, not a
 * length. Desks read in seconds because that is what their axes are labelled in and what
 * `tickToSeconds`, `asBPM` and every drawn tempo already speak.
 *
 * Both mistakes that gap invites are silent. Take a millisecond value for seconds and the x-axis
 * is a thousand times too wide and the tempo a thousand times too low; take the absolute end for
 * a duration and a note near the close of the piece reads as lasting three minutes. Neither
 * raises a type error or crashes, because every value involved is a finite number.
 *
 * **The conversion belongs here, once, named** — not spelled `/ 1000` at forty call sites where
 * one of them will eventually be missed.
 *
 * The rule for a desk: never touch `milliseconds.*` directly. Ask one of these.
 */

/** Seconds from the start of the recording to this note's onset. */
export const onsetSeconds = (note: Pick<AlignedNote, 'milliseconds.date'>): number =>
    note['milliseconds.date'] / 1000;

/** Seconds from the start of the recording to this note's release. */
export const releaseSeconds = (note: Pick<AlignedNote, 'milliseconds.date.end'>): number =>
    note['milliseconds.date.end'] / 1000;

/**
 * How long the note sounded, in seconds.
 *
 * The subtraction is the whole point: `milliseconds.date.end` is an absolute release, not a
 * length. Reading one as the other is the mistake this exists to make impossible to write by
 * accident.
 */
export const soundedSeconds = (
    note: Pick<AlignedNote, 'milliseconds.date' | 'milliseconds.date.end'>,
): number => (note['milliseconds.date.end'] - note['milliseconds.date']) / 1000;

/** Seconds to a recorded pedal's depression. */
export const pedalOnsetSeconds = (pedal: Pick<AlignedPedal, 'milliseconds.date'>): number =>
    pedal['milliseconds.date'] / 1000;

/** How long a recorded pedal was held, in seconds. */
export const pedalHeldSeconds = (
    pedal: Pick<AlignedPedal, 'milliseconds.date' | 'milliseconds.date.end'>,
): number => (pedal['milliseconds.date.end'] - pedal['milliseconds.date']) / 1000;

/**
 * Whether the recording sounded this note at all.
 *
 * A score note the roll never played carries no onset, left non-finite. The test is for
 * finiteness rather than falsiness: a `0` onset is a note sounding at the very start of the
 * piece, which is a different thing from a note that never sounded.
 */
export const wasSounded = (note: Pick<AlignedNote, 'milliseconds.date'>): boolean =>
    Number.isFinite(note['milliseconds.date']);

/**
 * The inverse: state when a note sounds, from seconds.
 *
 * There is exactly one legitimate reason for a desk to *write* physical timing — a preview note,
 * synthesized at a computed offset rather than read from the recording, on its way to `asMIDI`.
 * `TemporalSpreadInstruction` builds one to audition an arpeggio before it is committed.
 *
 * It exists for the same reason the readers above do, in the direction that is easier to get
 * wrong: the fields are milliseconds and take an absolute END, while everything a desk computes
 * is seconds and a length. Written by hand that is two conversions and one subtraction to
 * remember at a call site that only appears once, which is precisely where it will be missed.
 *
 * @param onset seconds from the start of the recording
 * @param sounded how long the note is to sound, in seconds
 */
export const soundingAt = (
    onset: number,
    sounded: number,
): { 'milliseconds.date': number; 'milliseconds.date.end': number } => ({
    'milliseconds.date': onset * 1000,
    'milliseconds.date.end': (onset + sounded) * 1000,
});
