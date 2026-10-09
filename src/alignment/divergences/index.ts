/**
 * What the score and the performance disagree about, grouped into things a
 * reader can act on.
 *
 * The aligner's flat lists are unusable as they stand: a trill alone contributes
 * a dozen unmatched played notes, with nothing to show they are one event.
 *
 * Substitutions are the aligner's blind spot. It labels every note matched or
 * unmatched, so a written note played as a different note arrives as a missing
 * note here and an added note there. They are paired back up before anything is
 * read.
 *
 * Every divergence carries a proposed reading and its reason; the reader
 * confirms or overrules.
 */

import { readPlayed, type AddedContext } from "./added";
import { acceptAttribution, type AcceptedAnchor } from "./attribution";
import { groupPlayed, groupUnplayed } from "./grouping";
import { missingContextOf, readUnplayed } from "./missing";
import { pairReplacements } from "./replaced";
import { timeMapOf, type Anchor } from "./timeMap";
import { DEFAULTS, type Divergence, type DivergenceInput, type DivergenceOptions } from "./types";

export type {
    AddedDivergence,
    AddedReading,
    Divergence,
    MissingDivergence,
    MissingReading,
    ReplacedDivergence,
    ReplacedReading,
} from "./types";

/**
 * Group, pair, anchor and read every disagreement.
 *
 * The order is load-bearing. Both sides are grouped into events first, because
 * only whole events can be compared. Substitutions are then paired off and taken
 * out of both lists, so the same moment is not reported twice. Only what is left
 * is anchored and read: three notes a semitone apart are a trill only once you
 * know which written note they surround.
 */
export function divergencesOf(
    input: DivergenceInput,
    options: DivergenceOptions = {}
): Divergence[] {
    const settings = { ...DEFAULTS, ...options };

    const spanById = new Map(input.spans.map((span) => [span.id, span]));
    const scoreById = new Map(input.scoreNotes.map((note) => [note.note, note]));

    // The time map: what each matched score note turned into when it was played.
    const anchors: Anchor[] = [];
    for (const match of input.matches) {
        const span = spanById.get(match.performanceId);
        const note = scoreById.get(match.scoreId);
        if (span && note) {
            anchors.push({
                scoreId: match.scoreId,
                onset: note.onset,
                onsetMs: span.onsetMs,
                pitch: note.pitch,
            });
        }
    }
    anchors.sort((a, b) => a.onsetMs - b.onsetMs);

    // Where the recording reaches. A score note outside it was not left out by
    // the performer, and reporting it as such invents a musical fact.
    const firstMs = anchors.length > 0 ? anchors[0].onsetMs : Infinity;
    const lastMs = anchors.length > 0 ? anchors[anchors.length - 1].onsetMs : -Infinity;

    // Once: the grouping, the pairing and the reading all need the same answer
    // and must not be able to disagree about it.
    const accepted = new Map<string, AcceptedAnchor>();
    for (const insertion of input.insertions) {
        const answer = acceptAttribution(
            insertion,
            input.signs,
            settings.attributionPosterior,
            settings.attributionShare
        );
        if (answer) accepted.set(insertion.performanceId, answer);
    }

    const played = groupPlayed(
        input,
        spanById,
        anchors,
        accepted,
        settings.gapMs,
        settings.attributedGapMs
    );
    const unplayed = groupUnplayed(input, scoreById);

    const { replaced, playedLeft, unplayedLeft } = pairReplacements(
        played,
        unplayed,
        timeMapOf(anchors),
        accepted,
        settings
    );

    const ctx: AddedContext = {
        anchors,
        anchorByScoreId: new Map(anchors.map((anchor) => [anchor.scoreId, anchor])),
        scoreById,
        accepted,
        firstMs,
        lastMs,
        simultaneousMs: settings.simultaneousMs,
        figureNotes: settings.figureNotes,
        hasRepeats: settings.hasRepeats,
    };

    const missingCtx = missingContextOf(input, scoreById, anchors.length > 0);

    return [
        ...replaced,
        ...playedLeft.map((group) => readPlayed(group, input, ctx)),
        ...unplayedLeft.map((group) => readUnplayed(group, missingCtx)),
    ];
}
