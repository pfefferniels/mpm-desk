import type { Divergence } from '../../alignment/divergences';
import type { MatchedNote, DeletedNote } from '../../alignment/mlign';

/**
 * What the score is coloured by, and why it is coloured that way round.
 *
 * A matched note is grey. It is the ordinary case and most of the page, and nothing about it needs
 * looking at — which is exactly what grey says. The colours that carry any weight are the
 * disagreements: red where the score has a note the recording never reached, green where the
 * recording has a note the score never wrote, violet where one was played as another.
 */
export const MATCHED_COLOUR = '#6b7280';
/** A note verovio could place nowhere: nothing is known about it, rather than something. */
export const UNALIGNED_COLOUR = '#c9ced6';
/** A written note the recording played as something else: sounded, but not as written. */
export const REPLACED_COLOUR = '#7c3aed';
/** Whichever disagreement the reader currently has open. */
export const SELECTED_COLOUR = '#1d4ed8';
/** A note sounding, while the performance is being listened to. */
export const PLAYING_COLOUR = '#f97316';

const CLASSES = [
    'alignment-matched',
    'alignment-unplayed',
    'alignment-outside',
    'alignment-replaced',
    'alignment-selected',
];

/**
 * What each note of the score is, as far as the colouring is concerned.
 *
 * Separated from the painting because it is the part with rules in it and none of it needs a DOM:
 * which notes count as unplayed depends on the confidence floor, on what the reader has hidden and
 * on which of them turned out to be one note played as another, and each of those is a decision
 * that can be got wrong quietly.
 */
export interface Painting {
    matched: ReadonlySet<string>;
    /** Written, and nothing in the recording answers to it. */
    unplayed: ReadonlySet<string>;
    /** Beyond where the recording reaches — not something the performer did. */
    outside: ReadonlySet<string>;
    /** Written notes played as another note, each naming the disagreement it belongs to. */
    replaced: ReadonlyMap<string, string>;
    /** Every note a click can ask about, and what it would ask about. */
    divergenceOf: ReadonlyMap<string, string>;
}

export interface PaintingInput {
    matches: readonly MatchedNote[];
    deletions: readonly DeletedNote[];
    divergences: readonly Divergence[];
    /** Matches the model was less sure of than this stand in the score as unplayed. */
    minConfidence: number;
    /** Matches in a passage the engraving cannot show — a repeat written with signs. */
    hidden: ReadonlySet<string>;
}

export const paintingOf = ({
    matches,
    deletions,
    divergences,
    minConfidence,
    hidden,
}: PaintingInput): Painting => {
    // A written note played as another note is not unplayed: it sounded, and the score shows it
    // in its own colour rather than as one of the notes the recording never reached.
    const replaced = new Map(
        divergences
            .filter((divergence) => divergence.kind === 'replaced')
            .map((divergence) => [divergence.scoreId, divergence.id]),
    );

    const matched = new Set(
        matches
            .filter((match) => match.confidence >= minConfidence && !hidden.has(match.scoreId))
            .map((match) => match.scoreId),
    );

    const unplayed = new Set(
        [
            ...deletions.map((deletion) => deletion.scoreId),
            // A match the reader asked not to see stands in the score as unplayed
            ...matches
                .filter((match) => match.confidence < minConfidence)
                .map((match) => match.scoreId),
        ].filter((id) => !replaced.has(id)),
    );

    const outside = new Set(
        divergences.flatMap((divergence) =>
            divergence.kind === 'missing' && divergence.reading === 'outside'
                ? divergence.scoreIds
                : [],
        ),
    );

    // Which disagreement each note the recording disagreed about belongs to, so that clicking one
    // asks about it. The crosses carry this already; a notehead is something verovio drew, so it
    // has to be told.
    const divergenceOf = new Map(replaced);
    for (const divergence of divergences) {
        if (divergence.kind !== 'missing') continue;
        for (const id of divergence.scoreIds) divergenceOf.set(id, divergence.id);
    }

    return { matched, unplayed, outside, replaced, divergenceOf };
};

const escaped = (id: string) => (typeof CSS?.escape === 'function' ? CSS.escape(id) : id);

/**
 * Colour the engraving, and say what each mark on it would be asked about.
 *
 * Attributes and classes only, which is what lets `Score`'s observer tell this apart from a new
 * render — see the note there. The notes that went unplayed are painted here rather than left to
 * verovio's own `data-perf-unaligned`: that only marks a note it could not place at all, and a
 * note in a chord or under a tie whose neighbours were matched is placed from theirs, so most
 * deletions would go unmarked.
 */
export const paintAlignment = (
    root: HTMLElement,
    painting: Painting,
    selected: string | undefined,
): void => {
    for (const element of root.querySelectorAll(CLASSES.map((name) => `.${name}`).join(', '))) {
        element.classList.remove(...CLASSES);
    }

    const find = (id: string) => root.querySelector(`[data-id="${escaped(id)}"]`);

    for (const id of painting.matched) find(id)?.classList.add('alignment-matched');

    for (const id of painting.unplayed) {
        const element = find(id);
        if (!element) continue;

        element.classList.add(
            painting.outside.has(id) ? 'alignment-outside' : 'alignment-unplayed',
        );
        const divergence = painting.divergenceOf.get(id);
        if (divergence) {
            element.setAttribute('data-divergence', divergence);
            (element as SVGElement).style.cursor = 'pointer';
        }
    }

    for (const [id, divergence] of painting.replaced) {
        const element = find(id);
        if (!element) continue;

        element.classList.add('alignment-replaced');
        element.setAttribute('data-divergence', divergence);
        (element as SVGElement).style.cursor = 'pointer';
    }

    if (!selected) return;

    // What the reader has open, so the popover and the music agree about which notes are being
    // talked about. The crosses and brackets carry the id themselves; the noteheads are told above.
    for (const element of root.querySelectorAll(
        `[data-divergence="${escaped(selected)}"]`,
    )) {
        element.classList.add('alignment-selected');
    }
};

/** The sheet the classes above mean something under, scoped to one engraving. */
export const alignmentStyles = (extra: string, omitted: string) => {
    const ink = (colour: string) => ({
        fill: `${colour} !important`,
        stroke: `${colour} !important`,
    });

    // All of these have the same specificity, so their order is what decides a note that is more
    // than one of them: a judgement over what verovio could not place, what the reader has open
    // over the judgement, and what is sounding over everything, because that lasts half a second
    // and has to be seen.
    return {
        '.alignment-score [data-perf-unaligned], .alignment-score [data-perf-unaligned] *':
            ink(UNALIGNED_COLOUR),
        '.alignment-score .alignment-matched, .alignment-score .alignment-matched *':
            ink(MATCHED_COLOUR),
        '.alignment-score .alignment-unplayed, .alignment-score .alignment-unplayed *':
            ink(omitted),
        // Not something the performer did: the recording simply does not reach here
        '.alignment-score .alignment-outside, .alignment-score .alignment-outside *':
            ink(UNALIGNED_COLOUR),
        '.alignment-score .alignment-replaced, .alignment-score .alignment-replaced *':
            ink(REPLACED_COLOUR),
        '.alignment-score .alignment-selected, .alignment-score .alignment-selected *':
            ink(SELECTED_COLOUR),
        '.alignment-score .note-playing, .alignment-score .note-playing *': ink(PLAYING_COLOUR),
        '.alignment-score .performanceExtraNote': { color: extra },
    };
};
