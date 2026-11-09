/**
 * A call's address: the start of its id, as long as it takes to name it alone.
 *
 * What the URL's hash carries, in the editor and the viewer alike, and what
 * `https://welte225.org/mpm/<address>` is sent on with. A call id is a UUID, too long to cite, and
 * eight characters of one are as good as the whole as long as no other call starts the same way.
 * Where one does, the address grows until it names one call.
 */

/** Shorter than this, a prefix is not taken for an address: it would match too much by chance. */
export const MIN_ADDRESS = 8;

/** The shortest start of `id`, at least {@link MIN_ADDRESS} long, that no other of `ids` shares. */
export const callAddress = (id: string, ids: readonly string[]): string => {
    for (let length = MIN_ADDRESS; length < id.length; length++) {
        const prefix = id.slice(0, length);
        if (!ids.some((other) => other !== id && other.startsWith(prefix))) return prefix;
    }
    return id;
};

/**
 * The one call an address names, or undefined where it names none or several.
 *
 * Several is not resolved to the first: a link that opened whichever of two calls the file
 * happens to list first would open a different decision when the file is reordered. A whole id
 * names its call even where another id starts with it.
 */
export const callAt = <T extends { id: string }>(address: string, calls: readonly T[]): T | undefined => {
    if (address.length < MIN_ADDRESS) return undefined;
    const exact = calls.find((call) => call.id === address);
    if (exact) return exact;
    const matches = calls.filter((call) => call.id.startsWith(address));
    return matches.length === 1 ? matches[0] : undefined;
};
