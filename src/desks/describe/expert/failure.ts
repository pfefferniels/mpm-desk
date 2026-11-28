import type { ExpertFailure } from './types';

/**
 * Why the expert gave no answer.
 *
 * Its message is the reason and nothing of the request: the desk words what the reader is told,
 * and the key the request was made with must not travel in an error.
 */
export class ExpertError extends Error {
    readonly reason: ExpertFailure;

    constructor(reason: ExpertFailure, options?: ErrorOptions) {
        super(`The expert gave no answer: ${reason}`, options);
        this.name = 'ExpertError';
        this.reason = reason;
    }
}
