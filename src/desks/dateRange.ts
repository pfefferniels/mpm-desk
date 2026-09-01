/**
 * A stretch of the tick grid, as the desks that mark one out by clicking its ends spell it.
 *
 * Structural on purpose: it stands for `MakeChoice`'s `RangeChoice` and `Modify`'s ranged
 * selector alike, so neither transformer has to know about the other or about the desks.
 */
export interface DateRange {
    from: number;
    to: number;
}

/**
 * The stretch covering the dates given, of which there is at least one.
 *
 * The ordering is the whole point. Downstream a range is read as `date >= from && date <= to` —
 * `MakeChoice`, `Modify` and `ScopedScore.notesInRange` all spell it that way — so a pair left in
 * the order it was clicked covers nothing at all once the second click landed before the first.
 * Reaching backwards is an ordinary gesture, and it means the stretch it reached over.
 */
export const rangeCovering = (date: number, ...more: number[]): DateRange => ({
    from: Math.min(date, ...more),
    to: Math.max(date, ...more),
});

/**
 * The stretch a shift-click at `date` leaves behind: the end nearer the click moves to it and the
 * far one holds, so the same gesture reaches further out or pulls back in.
 */
export const reachedTo = (range: DateRange, date: number): DateRange =>
    rangeCovering(
        date,
        Math.abs(date - range.from) > Math.abs(date - range.to) ? range.from : range.to,
    );
