import type { Divergence } from '../../alignment/divergences';
import type { MatchedNote, DeletedNote } from '../../alignment/mlign';
import type { Outcome } from '../../alignment/transcription';

/**
 * What the score is coloured by, and why it is coloured that way round.
 *
 * A matched note is grey. It is the ordinary case and most of the page, and nothing about it needs
 * looking at — which is exactly what grey says. The colours that carry any weight are what the
 * performer did differently, and there are three of them because there are three things a
 * performer can do to a note: play one the score does not have (green), leave one out (red), or
 * play it as another (violet). The green and violet notes are in the score, written there by the
 * transcriber; the red ones are what the performance reading no longer has.
 */
const MATCHED_COLOUR = '#6b7280';
/** A note verovio could place nowhere: nothing is known about it, rather than something. */
const UNALIGNED_COLOUR = '#c9ced6';
/** A written note the recording played as something else: sounded, but not as written. */
export const REPLACED_COLOUR = '#7c3aed';
/** Whichever disagreement the reader currently has open. */
const SELECTED_COLOUR = '#1d4ed8';
/** A note sounding, while the performance is being listened to. */
const PLAYING_COLOUR = '#f97316';

const CLASSES = [
    'alignment-matched',
    'alignment-added',
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
interface Painting {
    matched: ReadonlySet<string>;
    /** Written, and nothing in the recording answers to it. */
    unplayed: ReadonlySet<string>;
    /** Beyond where the recording reaches — not something the performer did. */
    outside: ReadonlySet<string>;
    /**
     * Notes played as another note, each naming the disagreement it belongs to: the played note
     * where the transcriber wrote it in, and the written one where it was left standing.
     */
    replaced: ReadonlyMap<string, string>;
    /** Played notes written into the score, each naming the disagreement it belongs to. */
    added: ReadonlyMap<string, string>;
    /** Written notes nothing answered to that are *not* taken out: a unison's twin, a cut. */
    kept: ReadonlySet<string>;
    /** Every note a click can ask about, and what it would ask about. */
    divergenceOf: ReadonlyMap<string, string>;
}

interface PaintingInput {
    matches: readonly MatchedNote[];
    deletions: readonly DeletedNote[];
    divergences: readonly Divergence[];
    /** Matches the model was less sure of than this stand in the score as unplayed. */
    minConfidence: number;
    /** Matches in a passage the engraving cannot show — a repeat written with signs. */
    hidden: ReadonlySet<string>;
    /** What the transcriber wrote for each divergence; without it nothing counts as written. */
    outcomes?: ReadonlyMap<string, Outcome>;
}

export const paintingOf = ({
    matches,
    deletions,
    divergences,
    minConfidence,
    hidden,
    outcomes,
}: PaintingInput): Painting => {
    // A written note played as another note is not unplayed: it sounded, and the score shows it
    // in its own colour rather than as one of the notes the recording never reached.
    const written = new Map(
        divergences
            .filter((divergence) => divergence.kind === 'replaced')
            .map((divergence) => [divergence.scoreId, divergence.id]),
    );

    // Where the played note was written in its place, that is the note on the page, under the
    // id the transcriber gave it. A pair the aligner merely failed to make is no change at all.
    const replaced = new Map<string, string>();
    for (const divergence of divergences) {
        if (divergence.kind !== 'replaced') continue;
        const outcome = outcomes?.get(divergence.id);
        if (outcome?.written === 'as-written') continue;
        replaced.set(outcome?.noteIds[0] ?? divergence.scoreId, divergence.id);
    }

    const added = new Map<string, string>();
    const kept = new Set<string>();
    for (const divergence of divergences) {
        const outcome = outcomes?.get(divergence.id);
        if (!outcome) continue;
        if (divergence.kind === 'added') {
            for (const id of outcome.noteIds) added.set(id, divergence.id);
        } else if (divergence.kind === 'missing' && outcome.written !== 'omitted') {
            for (const id of divergence.scoreIds) kept.add(id);
        }
    }

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
        ].filter((id) => !written.has(id)),
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

    return { matched, unplayed, outside, replaced, added, kept, divergenceOf };
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
            painting.outside.has(id) || painting.kept.has(id)
                ? 'alignment-outside'
                : 'alignment-unplayed',
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

    for (const [id, divergence] of painting.added) {
        const element = find(id);
        if (!element) continue;

        element.classList.remove('alignment-matched');
        element.classList.add('alignment-added');
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

    /**
     * Ink that is not thinned by how softly the note was played.
     *
     * The performed layout draws a quiet note faint, which is right for the notes that were
     * played as written and wrong for the ones this desk exists to show: an added note struck
     * pianissimo would be a pale green smudge on a page of pale grey. What the performer did
     * differently is drawn at full strength however it was played.
     */
    const marked = (colour: string) => ({ ...ink(colour), opacity: '1 !important' });

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
            marked(omitted),
        // Not something the performer did: the recording simply does not reach here
        '.alignment-score .alignment-outside, .alignment-score .alignment-outside *':
            ink(UNALIGNED_COLOUR),
        '.alignment-score .alignment-replaced, .alignment-score .alignment-replaced *':
            marked(REPLACED_COLOUR),
        '.alignment-score .alignment-added, .alignment-score .alignment-added *': marked(extra),
        '.alignment-score .alignment-selected, .alignment-score .alignment-selected *':
            marked(SELECTED_COLOUR),
        '.alignment-score .note-playing, .alignment-score .note-playing *': ink(PLAYING_COLOUR),
        // The bar in the editor is about where notes stand and what they are. Pedal marks,
        // dynamics, slurs and words are true of the bar and nothing to do with that.
        '.alignment-bar .pedal, .alignment-bar .dir, .alignment-bar .dynam, .alignment-bar .hairpin, .alignment-bar .tempo, .alignment-bar .slur, .alignment-bar .harm, .alignment-bar .fing, .alignment-bar .label, .alignment-bar .labelAbbr':
            { display: 'none' },
        // The note the editor's hands are on, ringed rather than recoloured: its colour is what
        // says what it is
        '.alignment-bar .alignment-editing': {
            filter: `drop-shadow(0 0 3px ${SELECTED_COLOUR}) drop-shadow(0 0 1px ${SELECTED_COLOUR})`,
        },
        '.alignment-score .performanceExtraNote': { color: extra },
    };
};
