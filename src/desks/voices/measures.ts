/**
 * Bar numbers, and where they begin on the tick grid.
 *
 * Read out of the MEI rather than off the rendered SVG, for two reasons: it exists before the
 * toolkit has finished loading, so the bar fields are live on first paint; and it does not change
 * when the layout toggle repaginates the score, which a table derived from pagination would.
 *
 * A bar's tick is the earliest date of any note in it. A bar holding only rests has no note to ask
 * and is simply absent — asking for it answers `undefined`, which is what a caller has to handle
 * anyway for a bar number nobody typed.
 */
export const measureTicks = (
    mei: string,
    dates: ReadonlyMap<string, number>,
): Map<number, number> => {
    const doc = new DOMParser().parseFromString(mei, 'application/xml');
    const ticks = new Map<number, number>();

    for (const measure of doc.querySelectorAll('measure')) {
        const n = Number(measure.getAttribute('n'));
        if (!Number.isFinite(n)) continue;

        let earliest: number | undefined;
        for (const note of measure.querySelectorAll('note')) {
            const id = note.getAttribute('xml:id');
            const date = id === null ? undefined : dates.get(id);
            if (date === undefined) continue;
            if (earliest === undefined || date < earliest) earliest = date;
        }

        if (earliest !== undefined) ticks.set(n, earliest);
    }

    return ticks;
};

/**
 * The stretch of the tick grid two bar numbers cover, ends included.
 *
 * `to` reaches to the start of the bar *after* `to`, so naming one bar covers that whole bar
 * rather than its downbeat. Where nothing follows, the range is open and answers `Infinity` — the
 * caller is selecting to the end of the piece.
 */
export const tickRange = (
    ticks: ReadonlyMap<number, number>,
    from: number,
    to: number,
): { from: number; to: number } | undefined => {
    const start = ticks.get(Math.min(from, to));
    if (start === undefined) return undefined;

    const last = Math.max(from, to);
    const after = ticks.get(last + 1);
    if (after !== undefined) return { from: start, to: after };

    const end = ticks.get(last);
    if (end === undefined) return undefined;
    return { from: start, to: Infinity };
};
