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
}
