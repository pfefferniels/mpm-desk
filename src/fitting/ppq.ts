/**
 * The tick resolution this application writes, and the units derived from it.
 *
 * espressivo takes `ppq` as an argument everywhere, because it is a property of the *document*:
 * `<msm pulsesPerQuarter="720">` and `<performance pulsesPerQuarter="720">` both state it, and a
 * library has no business deciding what grid a document it was handed is on.
 *
 * mpm-desk does get to decide, being the one writing them. It writes 720 and only 720, which is
 * what the alignment is serialized at and what every performance it builds declares, so every
 * conversion below may assume it. Here rather than in the library, because a constant in
 * espressivo explaining that this application writes 720 would be an application's policy stated
 * inside a library.
 *
 * The arithmetic is espressivo's, called with that one number. Spelled out at the call sites the
 * resolution appears eleven times across six files in four spellings (`720`, `2880`, `4 * 720`,
 * `720 / 4`).
 *
 * If a second resolution ever has to be supported, this is the file that stops being true, and
 * the call sites below are the exhaustive list of what has to start taking it as a parameter.
 */
import {
    DEFAULT_PULSES_PER_QUARTER,
    beatLengthInTicks as beatLengthInTicksAt,
    pulsesPerWhole,
} from 'espressivo';

/** Ticks per quarter note, in every document this application writes. */
export const PULSES_PER_QUARTER = DEFAULT_PULSES_PER_QUARTER;

/** Ticks per whole note — the unit `@beatLength` is a fraction of. */
export const PULSES_PER_WHOLE = pulsesPerWhole(PULSES_PER_QUARTER);

/**
 * The tick length of one beat of the given `@beatLength`.
 *
 * `beatLength` is a fraction of a whole note, so 0.25 is a quarter and answers
 * {@link PULSES_PER_QUARTER}.
 */
export const beatLengthInTicks = (beatLength: number): number =>
    beatLengthInTicksAt(beatLength, PULSES_PER_QUARTER);
