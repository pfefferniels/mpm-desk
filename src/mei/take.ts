/**
 * The name a take goes by.
 *
 * One string names a take everywhere: the `@source` of its `<recording>`, the `source` of every
 * note read out of it, what a `MakeChoice` prefers and what verovio's `performanceRecording` lays
 * out by. The as-played-by format asks that `@source` point at an element of the document, so it
 * is a reference, `#take-…`, to the take's `<manifestation>` in the header, whose `xml:id` is the
 * same without the `#`.
 *
 * What follows `take-` is what the take was read from: the version of the roll a scan names in
 * its second text event, or else the file's stem. `take-` because an `xml:id` must not begin with
 * a digit, and the id of a roll's version is a UUID, which may (`0e5f443d-…`). Whatever else an
 * `xml:id` cannot hold becomes a hyphen, so that `Träumerei (2).mid` still names a take.
 *
 * https://github.com/pfefferniels/as-played-by
 */
export const takeSource = (name: string): string =>
    `#take-${name.replace(/[^\p{L}\p{M}\p{N}._-]/gu, '-')}`;

/**
 * The `xml:id` of the `<manifestation>` a take's `@source` points at.
 *
 * A `@source` written before takes were named so is the id itself, with no `#`, and stays it.
 */
export const manifestationIdOf = (source: string): string => source.replace(/^#/, '');
