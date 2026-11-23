import { rowId } from '../fitting/alignment';

/** Whether the reference is an IRI of its own, rather than one read against the document's address. */
const isIri = (reference: string): boolean => {
    if (!URL.canParse(reference)) return false;
    const { protocol } = new URL(reference);
    return protocol === 'https:' || protocol === 'http:';
};

/**
 * The symbol of the roll each reading of a note performs, by row (`rowId`): the IRI its `<when>`
 * gives in `@corresp`.
 *
 * Roll Desk labels every note of a version it performs with the IRI of the symbol that sounds it,
 * and the import keeps the label as the `@corresp` of the `<when>` the note is aligned in. A
 * substitution names the symbol that sounded, at the pitch it sounded at, since that is what the
 * take has of the note.
 *
 * Only an IRI is taken. A take imported before Roll Desk wrote them labels its notes with the bare
 * id (`symbol_…`), which read against the transcription's own address would name a call of the
 * reconstruction rather than a symbol of the roll; a take read from a file nothing labelled names
 * the note `asSpans` minted. A pedal's `<when>` times no written note and is left out.
 */
export const symbolsOf = (mei: string): Map<string, string> => {
    const doc = new DOMParser().parseFromString(mei, 'application/xml');
    const symbols = new Map<string, string>();

    for (const recording of doc.querySelectorAll('recording')) {
        const source = recording.getAttribute('source') || undefined;
        for (const when of recording.querySelectorAll('when[data][corresp]')) {
            const symbol = when.getAttribute('corresp')?.split(/\s+/).find(isIri);
            if (!symbol) continue;
            for (const reference of when.getAttribute('data')?.split(/\s+/) ?? []) {
                const id = reference.replace(/^#/, '');
                if (id) symbols.set(rowId({ 'xml:id': id, source }), symbol);
            }
        }
    }

    return symbols;
};
