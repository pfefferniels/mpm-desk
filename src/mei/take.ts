/**
 * What a take is named after: the id an IRI ends in, or else the name as it stands.
 *
 * Roll Desk names the version a file performs by its IRI (`https://welte225.org/<id>`), and the
 * take goes by the id still, as every take named before did. Whatever the IRI says beyond it is
 * the edition's address, which does not tell one take from another.
 */
const idOf = (name: string): string => {
    if (!URL.canParse(name)) return name;
    const { protocol, pathname } = new URL(name);
    if (protocol !== 'https:' && protocol !== 'http:') return name;
    const last = pathname.split('/').filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : name;
};

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
 * its second text event, by its IRI or by its bare id, or else the file's stem. `take-` because
 * an `xml:id` must not begin with a digit, and the id of a roll's version is a UUID, which may
 * (`0e5f443d-…`). Whatever else an `xml:id` cannot hold becomes a hyphen, so that
 * `Träumerei (2).mid` still names a take.
 *
 * https://github.com/pfefferniels/as-played-by
 */
export const takeSource = (name: string): string =>
    `#take-${idOf(name).replace(/[^\p{L}\p{M}\p{N}._-]/gu, '-')}`;

/**
 * The `xml:id` of the `<manifestation>` a take's `@source` points at.
 *
 * A `@source` written before takes were named so is the id itself, with no `#`, and stays it.
 */
export const manifestationIdOf = (source: string): string => source.replace(/^#/, '');
