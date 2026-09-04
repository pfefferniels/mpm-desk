import { prettyXml } from 'espressivo';

/**
 * One line of the document as the desk shows it.
 *
 * `id` and `type` are present together or not at all: an `xml:id` is what makes a line something
 * the rest of the editor can talk about, and the element that carries it is what gives the line
 * its lane colour.
 */
interface MarkupLine {
    /** The line as it will be shown, its indentation included. */
    text: string;
    /** The `xml:id` this line's opening tag carries. */
    id?: string;
    /** The element this line opens — `tempo`, `rubato`, `movement`. */
    type?: string;
}

interface Markup {
    lines: readonly MarkupLine[];
    /** `xml:id` ⇒ the line that opens it, for scrolling to what is selected. */
    lineOf: ReadonlyMap<string, number>;
}

/** An opening tag at the head of a line, after `prettyXml`'s indentation. */
const OPENING_TAG = /^\s*<([A-Za-z_][\w.-]*)/;
const XML_ID = /\bxml:id="([^"]*)"/;

const EMPTY: Markup = { lines: [], lineOf: new Map() };

/**
 * The document, indented and indexed by the ids the rest of the editor names elements by.
 *
 * ## Why this has to indent
 *
 * espressivo's serializer is contractually not a pretty-printer: `xml/XomTypes.ts` pins the bytes
 * and says "non-empty ones emit their children back to back with no added whitespace or
 * indentation", the integration suite comparing its output against Java-generated ground truth.
 * So a written MPM is *two lines*, the XML declaration and everything else, and the shipped
 * reconstruction puts 111,158 characters on the second. In a `<pre>` that is one horizontal
 * ribbon some fourteen hundred screen-widths long.
 *
 * `prettyXml` is espressivo's own answer and exists for this caller: its doc says "purely textual
 * and purely cosmetic" and "not used anywhere on the conversion path". Over the shipped MPM it
 * takes 0.6 ms and yields 1,135 lines, longest 202 characters, so there is nothing to virtualise
 * and no dependency to add. Its two documented blind spots, CDATA and XML comments, are not
 * things MPM or MSM contain; `<comment>` in the metadata is an element.
 *
 * ## The index is one pass, and what makes the desk part of the editor
 *
 * `CallSelection` speaks in `xml:id`s: `activeElements` is the ids the selected calls wrote, and
 * `setActiveElement` takes one back. The serializer puts an element and all its attributes on one
 * line, so a line maps one-to-one to an element and `lineOf` is the whole bridge. In the shipped
 * MPM 684 of the 1,135 lines carry an id.
 *
 * A duplicate id keeps its first line rather than its last, so that the ordering the document
 * states is the ordering the desk scrolls in. The MPM should have none; this is about not
 * silently reordering if it does.
 */
export const indexMarkup = (xml: string): Markup => {
    if (!xml) return EMPTY;

    const lines: MarkupLine[] = [];
    const lineOf = new Map<string, number>();

    for (const text of prettyXml(xml).split('\n')) {
        const id = XML_ID.exec(text)?.[1];
        if (id === undefined) {
            lines.push({ text });
            continue;
        }
        if (!lineOf.has(id)) lineOf.set(id, lines.length);
        const type = OPENING_TAG.exec(text)?.[1];
        lines.push({ text, id, ...(type !== undefined && { type }) });
    }

    return { lines, lineOf };
};
