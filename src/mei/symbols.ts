/** Whether the reference is an IRI of its own, rather than one read against the document's address. */
const isIri = (reference: string): boolean => {
    if (!URL.canParse(reference)) return false;
    const { protocol } = new URL(reference);
    return protocol === 'https:' || protocol === 'http:';
};

/**
 * The symbol of the roll a `<when>` performs: the IRI its `@corresp` gives, or nothing.
 *
 * Roll Desk labels every note of a version it performs with the IRI of the symbol that sounds it,
 * and the import keeps the label as the `@corresp` of the `<when>` the note is aligned in. A
 * substitution names the symbol that sounded, at the pitch it sounded at, since that is what the
 * take has of the note. A pedal's names the symbols of its steps, the first of which is taken.
 *
 * Only an IRI is taken. A take imported before Roll Desk wrote them labels its notes with the bare
 * id (`symbol_…`), which read against the transcription's own address would name a call of the
 * reconstruction rather than a symbol of the roll; a take read from a file nothing labelled names
 * the note `asSpans` minted.
 */
export const symbolOf = (when: Element): string | undefined =>
    when.getAttribute('corresp')?.split(/\s+/).find(isIri);
