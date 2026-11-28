/**
 * The describe desk's side of `description.worker.ts`.
 *
 * What the page imports of the description: this file holds the worker and the types of what it
 * answers, and loads none of the engine, so the fitted steps stay out of the page's registry.
 */
import type { Call } from '../../model/Work';
import type { AlignmentData } from '../fit.worker';
import type { DescriptionReply, DescriptionRequest } from './description.worker';
import type { BroughtOut, DescribeRunOptions, DescriptionRun } from './index';

export type {
    BroughtOut,
    DescribeRunOptions,
    DescriptionRun,
    RemarkReport,
    Roll,
    RollNote,
    Sounded,
    Step,
    StepReport,
} from './index';

export interface DescriptionClient {
    /**
     * Run a document: its calls, its remarks' steps, and what is assumed where nothing is
     * described.
     *
     * A run is not interrupted, and one overtaken by a newer request is wrong rather than late. So
     * of the requests made while one runs only the newest is run after it, and every request still
     * unanswered is answered with that newest run. A request with a `trial` is another matter: it
     * is always run, and answered with its own.
     *
     * A remark on trial takes the place of the calls made by hand it stands over, and its report
     * says which (`RemarkReport.displaced`, and per step `StepReport.displaces`); a remark the
     * document holds stands behind them (`StepReport.gaveWayTo`, `StepReport.behind`). Where
     * something is displaced, the reader is asked first. "Replace" is one `replaceCalls` from
     * the trial's run: out go the displaced calls, every `Describe` call and every call one of
     * them names; in go what is left of the displaced calls, then every remark of the run with
     * its `concrete`, the `Describe` call naming their ids, a new remark dated after every
     * other. "Keep" writes the remark alone, and the next plain run cuts it round what stands.
     * The whole of it, with the reasons, is at the head of `run.ts`.
     *
     * @param alignment the alignment as loaded. Sent to the worker when it does not hold the
     * arrays of the one sent last.
     */
    describe(
        alignment: AlignmentData,
        calls: readonly Call[],
        options?: DescribeRunOptions,
    ): Promise<DescriptionRun>;
    /**
     * The rendering of a run with the instructions `ids` brought out; see `bringOut`. Every request
     * is answered, in the order they were made.
     *
     * @param run the run the instructions belong to, as `describe` answered it.
     */
    bringOut(
        run: Pick<DescriptionRun, 'mpm' | 'score'>,
        ids: readonly string[],
        factor: number,
        attenuation: number,
    ): Promise<BroughtOut>;
    /** Stop the worker. What is still unanswered stays so. */
    dispose(): void;
}

type DescriptionWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

/** What an alignment is told from another by: the arrays it holds, whatever object carries them. */
const FIELDS = ['allNotes', 'pedals', 'graces', 'tiedPrincipals', 'timeSignatures'] as const;

interface Waiting<T> {
    resolve: (value: T) => void;
    reject: (reason: Error) => void;
}

const startWorker = (): DescriptionWorker =>
    new Worker(new URL('./description.worker.ts', import.meta.url), { type: 'module' });

/**
 * @param start how the worker is started; a test hands in one of its own. The worker is started
 * with the first request.
 */
export const createDescriptionClient = (
    start: () => DescriptionWorker = startWorker,
): DescriptionClient => {
    let worker: DescriptionWorker | null = null;
    let nextRequestId = 0;
    let loaded: AlignmentData | null = null;
    /** What to do with the reply to each request the worker has not answered yet. */
    const answers = new Map<number, (reply: DescriptionReply) => void>();

    /** Every plain `describe` still unanswered, the newest not yet sent, whether one is running. */
    let unanswered: Waiting<DescriptionRun>[] = [];
    let newest: (() => void) | null = null;
    let running = false;

    const send = (request: DescriptionRequest, answer?: (reply: DescriptionReply) => void) => {
        if (!worker) {
            worker = start();
            worker.onmessage = (event: MessageEvent<DescriptionReply>) => {
                const answered = answers.get(event.data.requestId);
                answers.delete(event.data.requestId);
                answered?.(event.data);
            };
            worker.onerror = (event) => {
                const outstanding = [...answers];
                answers.clear();
                for (const [requestId, answered] of outstanding) {
                    answered({ type: 'error', requestId, message: event.message });
                }
            };
        }
        if (answer) answers.set(request.requestId, answer);
        worker.postMessage(request);
    };

    const ask = (
        alignment: AlignmentData,
        calls: readonly Call[],
        trial: DescribeRunOptions['trial'],
        answer: (reply: DescriptionReply) => void,
    ) => {
        if (!loaded || FIELDS.some((field) => alignment[field] !== loaded?.[field])) {
            loaded = alignment;
            send({ type: 'load', requestId: nextRequestId++, alignment });
        }
        send(
            { type: 'describe', requestId: nextRequestId++, calls, ...(trial && { trial }) },
            answer,
        );
    };

    const settle = <T>(
        { resolve, reject }: Waiting<T>,
        reply: DescriptionReply,
        read: (reply: DescriptionReply) => T | undefined,
    ) => {
        const value = read(reply);
        if (value !== undefined) resolve(value);
        else
            reject(
                new Error(
                    reply.type === 'error' ? reply.message : `unexpected reply: ${reply.type}`,
                ),
            );
    };
    const described = (reply: DescriptionReply) =>
        reply.type === 'described' ? reply.run : undefined;
    const broughtOut = (reply: DescriptionReply) =>
        reply.type === 'brought-out' ? reply.result : undefined;

    return {
        describe: (alignment, calls, { trial } = {}) =>
            new Promise<DescriptionRun>((resolve, reject) => {
                if (trial) {
                    ask(alignment, calls, trial, (reply) =>
                        settle({ resolve, reject }, reply, described),
                    );
                    return;
                }
                unanswered.push({ resolve, reject });
                const run = () => {
                    running = true;
                    ask(alignment, calls, undefined, (reply) => {
                        running = false;
                        if (newest) {
                            // Overtaken while it ran: its answer is of a document edited past.
                            const overtaking = newest;
                            newest = null;
                            overtaking();
                            return;
                        }
                        const answered = unanswered;
                        unanswered = [];
                        for (const waiting of answered) settle(waiting, reply, described);
                    });
                };
                if (running) newest = run;
                else run();
            }),

        bringOut: ({ mpm, score }, ids, factor, attenuation) =>
            new Promise<BroughtOut>((resolve, reject) => {
                send(
                    {
                        type: 'bring-out',
                        requestId: nextRequestId++,
                        run: { mpm, score },
                        ids,
                        factor,
                        attenuation,
                    },
                    (reply) => settle({ resolve, reject }, reply, broughtOut),
                );
            }),

        dispose: () => {
            worker?.terminate();
            worker = null;
            loaded = null;
            answers.clear();
            unanswered = [];
            newest = null;
            running = false;
        },
    };
};
