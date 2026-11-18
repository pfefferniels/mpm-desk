/**
 * The performed layout, drawn from the matches the model is sure of.
 *
 * The performed layout puts every matched note at the moment it was struck. That is the point
 * of it, and also its weakness: a match the model was unsure of is drawn just as firmly as one
 * it was sure of, and where the match is wrong the note lands somewhere it was never played and
 * pulls the passage around it out of shape. A wrong match drawn in the right place is a lie the
 * eye believes.
 *
 * So a match is drawn as far towards its performed moment as the model is sure of it. One it is
 * sure of stands where it was struck. One it doubts stands where the score puts it between the
 * sure ones around it: at the moment it was *due*, given when its sure neighbours were played,
 * which is notation drawn at the local tempo. In between, in proportion.
 *
 * The notes nothing was matched to need nothing of this. verovio places a note without a
 * `<when>` by where it stands in the score between the timed notes either side of it (checked
 * against the vendored build), so it moves with the notes around it, and with this it moves with
 * the sure ones.
 *
 * Only the page is laid out this way. What is written into the document keeps the moments the
 * notes were struck at, and so does the time a note reports when it is played back or measured.
 */

/** A match the model is at least this sure of stands where it was struck. */
export const SURE = 0.95;

/** A match the model is less sure of than this stands where the score puts it. */
export const DOUBTFUL = 0.5;

interface Match {
    scoreId: string;
    performanceId: string;
    confidence: number;
}

/** How far towards its performed moment a match is drawn: 0 at the score's, 1 at its own. */
const trustOf = (confidence: number): number =>
    Math.min(1, Math.max(0, (confidence - DOUBTFUL) / (SURE - DOUBTFUL)));

/**
 * The moment a written note was due, read off the sure matches, as a function of where it stands
 * in the score.
 *
 * One point per place in the score a sure match was struck at: the middle of the moments its
 * notes were struck at, because a chord spread over a fifth of a second was still struck once,
 * and the middle is where the eye takes it to be. A point that runs back in time from the one
 * before it is dropped, so that what is drawn by it never runs backwards either.
 */
const dueOf = (points: readonly (readonly [number, number])[]) => {
    const byPlace = new Map<number, number[]>();
    for (const [place, ms] of points) {
        const at = byPlace.get(place);
        if (at) at.push(ms);
        else byPlace.set(place, [ms]);
    }

    const anchors: { place: number; ms: number }[] = [];
    for (const [place, struck] of [...byPlace].sort(([a], [b]) => a - b)) {
        struck.sort((a, b) => a - b);
        const middle = struck.length % 2 === 1
            ? struck[(struck.length - 1) / 2]
            : (struck[struck.length / 2 - 1] + struck[struck.length / 2]) / 2;
        const last = anchors.at(-1);
        if (last && middle < last.ms) continue;
        anchors.push({ place, ms: middle });
    }

    /** Undefined beyond the first or the last sure match: there is nothing to read it off. */
    return (place: number): number | undefined => {
        let lo = 0;
        let hi = anchors.length - 1;
        if (hi < 0 || place < anchors[0].place || place > anchors[hi].place) return undefined;
        // The last anchor at or before the place
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (anchors[mid].place <= place) lo = mid;
            else hi = mid - 1;
        }
        const before = anchors[lo];
        const after = anchors[lo + 1];
        if (before.place === place || !after) return before.ms;
        return before.ms + ((place - before.place) / (after.place - before.place)) * (after.ms - before.ms);
    };
};

/** A match drawn somewhere other than where it was struck, in milliseconds of the recording. */
interface Moved {
    struck: number;
    drawn: number;
}

/**
 * Where each match the model doubted is to be drawn, by the id of its written note.
 *
 * Only the matches that move are in it. A match outside the stretch the sure ones span, or whose
 * written note or performed note is not known, is drawn where it was struck: there is no score
 * position to draw it at instead.
 */
export function anchoredOnsets(
    matches: readonly Match[],
    /** Where each written note stands in the score, in quarter notes, by its id. */
    placeOf: ReadonlyMap<string, number>,
    /** When each performed note was struck, in milliseconds, by its id. */
    struckAt: ReadonlyMap<string, number>,
): Map<string, Moved> {
    const known = matches.flatMap((match) => {
        const place = placeOf.get(match.scoreId);
        const ms = struckAt.get(match.performanceId);
        return place === undefined || ms === undefined ? [] : [{ ...match, place, ms }];
    });

    const due = dueOf(
        known.filter((match) => match.confidence >= SURE).map((match) => [match.place, match.ms] as const),
    );

    const moved = new Map<string, Moved>();
    for (const match of known) {
        if (match.confidence >= SURE) continue;
        const at = due(match.place);
        if (at === undefined) continue;
        const drawn = at + trustOf(match.confidence) * (match.ms - at);
        if (Math.abs(drawn - match.ms) >= 1) moved.set(match.scoreId, { struck: match.ms, drawn });
    }
    return moved;
}

/**
 * The document with the moments of `source`'s matches replaced by the ones to draw them at.
 *
 * A `<when>` is rewritten only where it is the match itself, pointing at the written note and
 * standing at the moment that note was struck: several may point at one note (an ornament
 * played on it), and the others are not the match. A grace note is left where it was struck,
 * whatever the model thought of it. It stands at its principal's place in the score, so drawing
 * it by the score would put it on top of the note it leans on.
 */
export function anchoredLayout(
    mei: string,
    source: string,
    moved: ReadonlyMap<string, Moved>,
): string {
    if (moved.size === 0) return mei;

    const doc = new DOMParser().parseFromString(mei, 'application/xml');
    const recording = [...doc.getElementsByTagName('recording')].find(
        (element) => element.getAttribute('source') === source,
    );
    if (!recording) return mei;

    const graces = new Set<string>();
    for (const note of doc.getElementsByTagName('note')) {
        if (!note.hasAttribute('grace') && note.parentElement?.localName !== 'graceGrp') continue;
        const id = note.getAttribute('xml:id');
        if (id) graces.add(id);
    }

    let changed = false;
    for (const when of recording.getElementsByTagName('when')) {
        const target = when.getAttribute('data')?.replace(/^#/, '');
        if (!target || graces.has(target)) continue;
        const match = moved.get(target);
        if (!match || when.getAttribute('absolute') !== `${match.struck.toFixed(0)}ms`) continue;
        when.setAttribute('absolute', `${match.drawn.toFixed(0)}ms`);
        changed = true;
    }

    return changed ? new XMLSerializer().serializeToString(doc) : mei;
}
