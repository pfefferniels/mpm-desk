/**
 * One score note matched to one performed note.
 *
 * This is what every aligner of the project produces and what `applyAlignment`
 * writes into the MEI, so it belongs to neither aligner in particular: the naive
 * one in ./naiveAligner and the model in ./mlign both hand back these pairs.
 */
export type Match = {
    score_id: string;
    performance_id: string;
    /**
     * How sure the aligner was of the pair, in [0, 1], where it says.
     *
     * Kept on the `<when>` while the reader works, so that the page can draw a doubtful match
     * by the score rather than by the moment it was struck (see
     * `src/desks/alignment/anchoredLayout`). Not part of what is saved.
     */
    confidence?: number;
}
