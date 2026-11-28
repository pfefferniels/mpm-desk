import type { DescriptionRun, Step } from '../../../fitting/description/client';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import type { Call } from '../../../model/Work';

/** A remark as the expert is shown it. */
export interface RemarkInWords {
    /** The id of its `Describe` call; of a remark the document does not hold yet, the id it will have. */
    id: string;
    text: string;
    about: DescribedPlace;
    /** What it became before, if anything. */
    steps: readonly Step[];
}

export interface ExpertRequest {
    remark: RemarkInWords;
    /** What the expert asked about the remark earlier and what the reader answered, oldest first. */
    thread: readonly { question: string; answer: string }[];
    /** Set where its steps have to be written again: what the chain said of each that did not run. */
    mend?: readonly string[];
    /** Every other remark of the document. */
    others: readonly RemarkInWords[];
    /**
     * What was made by hand on the other desks: the calls of the document that are no remark and
     * that no remark owns. The expert is told of them where they are given.
     */
    byHand?: readonly Call[];
    /** The document as it stands. */
    run: DescriptionRun;
    piece: {
        title: string;
        /** Ticks per quarter note. */
        ppq: number;
        bars: readonly { n: number; from: number; to: number }[];
    };
    /** The document run with `steps` in place of the remark's own. Nothing of it is kept. */
    tryOut: (steps: readonly Step[]) => Promise<DescriptionRun>;
}

export interface ExpertAnswer {
    steps: Step[];
    /** What the expert has to know first, in the language of the remark. `steps` is then empty. */
    question: string | null;
    /** The model that answered. */
    model: string;
}

/**
 * Why no answer came: no key or one the API refuses, too many requests, the model declined, an
 * answer that cannot be read as steps, stopped by the reader, or anything else.
 */
export type ExpertFailure = 'key' | 'busy' | 'declined' | 'unreadable' | 'stopped' | 'failed';

export interface Expert {
    /** Rejects with an `ExpertError`. */
    ask(
        request: ExpertRequest,
        options?: { signal?: AbortSignal; onProgress?: (line: string) => void },
    ): Promise<ExpertAnswer>;
}
