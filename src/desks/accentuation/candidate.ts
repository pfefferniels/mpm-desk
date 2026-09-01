import type { InsertMetricalAccentuationOptions } from "../../fitting/transformers/accentuation/InsertMetricalAccentuation"
import type { PartialBy } from "../../utils/utils"
import { rangeCovering, reachedTo, type DateRange } from "../dateRange"

/** The stretch a pattern is fitted to, as `InsertMetricalAccentuation` wants it. */
export type Cell = Omit<InsertMetricalAccentuationOptions, 'scope'>

/**
 * A cell being marked out on the plot.
 *
 * `to` arrives with the second click; until then the cell has one end and the date under the
 * cursor stands in for the other, which is what {@link rangeOf} is for. The rubato desk marks a
 * frame the same way, and for the same reason: a range drawn between two clicks shows what it
 * will cover before it is committed to.
 */
export type Candidate = PartialBy<Cell, 'to'>

/** What a fresh candidate is fitted with until the dialog says otherwise. */
const defaults = { beatLength: 0.125, scaleTolerance: 0, neutralEnd: true }

/** Whether the candidate's far end is still following the cursor. */
export const isPending = (candidate: Candidate | undefined): boolean =>
    candidate !== undefined && candidate.to === undefined

/**
 * A cell is a stretch, and a pattern cycles on its length: one of no length is no pattern.
 *
 * Nothing else is asked of it. A cell that starts mid-cycle — a dotted quarter an eighth into
 * the bar, the stuff hemiolas are made of — is fitted at the phase it will be read on, so
 * where it begins is the reader's business and not the format's (issue #47).
 */
export const fittable = (candidate: Candidate): candidate is Cell =>
    candidate.to !== undefined && candidate.to > candidate.from

/** What the candidate covers right now, the cursor standing in for an end not yet clicked. */
export const rangeOf = (candidate: Candidate, cursor?: number): DateRange =>
    rangeCovering(candidate.from, candidate.to ?? cursor ?? candidate.from)

/**
 * The candidate a click at `date` leaves behind.
 *
 * One decision, taken once, over the candidate as it stands. Read as two — start one *and* extend
 * the one that is there — it went wrong in both directions (issue #25): the extending branch saw
 * the state from before the branch above had queued a new candidate, so the first shift-click of a
 * fresh selection was dropped, and it wrote `to` without comparing it against `from`, so reaching
 * backwards left the range inverted.
 *
 * Either order of clicks marks the same stretch: the second click is an end, not a direction. A
 * shift-click on a closed candidate moves whichever end is nearer it and holds the far one, so
 * the same gesture reaches further out or pulls back in.
 */
export const afterClick = (
    candidate: Candidate | undefined,
    date: number,
    shiftKey: boolean,
    mintName: () => string,
): Candidate => {
    if (candidate === undefined) return { from: date, name: mintName(), ...defaults }
    if (candidate.to === undefined) return { ...candidate, ...rangeOf(candidate, date) }
    if (!shiftKey) return { from: date, name: mintName(), ...defaults }

    return { ...candidate, ...reachedTo({ from: candidate.from, to: candidate.to }, date) }
}
