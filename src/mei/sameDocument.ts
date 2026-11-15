/**
 * Whether two MEI texts are the same document.
 *
 * Asked of what they say rather than of how they are spelled: the same score serialises with
 * its attributes in another order after a round trip through a DOM, and with other white space
 * between its elements, and neither is a difference anybody made.
 *
 * Everything else is one. A note on another staff, a note value, where in its layer an element
 * stands: a comparison that only counts the notes cannot see any of these, and a document that
 * is taken to hold what it does not hold is never written.
 */

const describe = (element: Element): string => {
    const attributes = [...element.attributes]
        .map((attribute) => `${attribute.name}="${attribute.value}"`)
        .sort()
        .join(" ");
    const children = [...element.children];
    // Text counts where it is what the element holds, and not where it only sets elements apart
    const inside =
        children.length > 0 ? children.map(describe).join("") : (element.textContent ?? "").trim();
    return `<${element.tagName} ${attributes}>${inside}</>`;
};

export function sameDocument(one: string, other: string): boolean {
    // The usual case, and the cheap one: nothing has been round-tripped at all
    if (one === other) return true;

    const parser = new DOMParser();
    const read = (text: string) => parser.parseFromString(text, "application/xml").documentElement;
    return describe(read(one)) === describe(read(other));
}
