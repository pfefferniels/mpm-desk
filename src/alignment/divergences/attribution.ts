import type { OrnamentSign } from "../../mei/ornamentSigns";
import type { InsertedNote } from "../mlign";

/** The head's answer about one played note, once it has been believed. */
export interface AcceptedAnchor {
    scoreId: string;
    /** P(it elaborates a written note at all), the decode having called it an insertion */
    gate: number;
    /** Of the mass on elaborating anything, the part on this one written note */
    share: number;
    /**
     * `gate * share`: P(it elaborates THAT written note | it is an insertion).
     * The only one of the three that moves with the anchor, so the one both
     * decided on and written down.
     */
    posterior: number;
    /** Whether an ornament sign the score already writes is what let it in */
    corroborated: boolean;
}

/**
 * Which of the head's answers to take, and on what evidence.
 *
 * Two routes, because the head's two numbers can come apart. The posterior is
 * enough on its own; short of it, a clear ranking is enough when the score
 * already writes an ornament sign on the note the head named, the sign having
 * answered the question the head was unsure of. The route is chosen per note by
 * what the numbers are, never by which checkpoint produced them.
 *
 * The posterior is the head's own two factors, not the whole row's mass. Every
 * note here is one the decode tried to pair and could not, so `P(insertion)` is
 * settled and not evidence to weigh again. Carrying it lets the match head veto
 * answers it was never asked for, silencing 48.8% of ornament figures on real
 * Batik; taking it out is worth whole-figure accuracy .1919 → .3297 there, on
 * the shipped checkpoint and with no new model.
 *
 * Batik is the only clean corpus to read this on: 209 of real ASAP's 225 rows
 * are performances the match head trained on, leaving 36 clean figures.
 *
 * Both factors rather than the gate alone, since a confident gate over a flat
 * ranking is how a played note that ornaments nothing acquires an anchor.
 */
export function acceptAttribution(
    insertion: InsertedNote,
    signs: ReadonlyMap<string, OrnamentSign[]>,
    minPosterior: number,
    minShare: number
): AcceptedAnchor | undefined {
    const named = insertion.ornamentOf;
    if (!named) return undefined;

    const answer = {
        scoreId: named.scoreId,
        gate: named.gate,
        share: named.share,
        posterior: named.gate * named.share,
    };

    if (answer.posterior >= minPosterior) return { ...answer, corroborated: false };
    if (named.share >= minShare && (signs.get(named.scoreId)?.length ?? 0) > 0) {
        return { ...answer, corroborated: true };
    }
    return undefined;
}
