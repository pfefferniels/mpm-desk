import type { DescriptionClient, Step } from '../../fitting/description/client';
import type { ExpertAnswer, ExpertFailure } from './expert/types';

/**
 * What is going on between the remarks and the expert, kept where a desk is not.
 *
 * A remark's words, its place and the steps it became are the document's. Everything else about
 * its way to those steps is not: that it waits its turn, what the expert is doing with it, what
 * it asked back and what was answered, why no answer came. None of that is true of the
 * reconstruction, so none of it is written into it; and all of it has to outlast the desk, which
 * is unmounted whenever the reader opens another, while an answer can be half a minute away.
 *
 * So it lives here, in a store a session holds outside every component, and the desk reads it
 * through `useSyncExternalStore` whenever it is on screen.
 *
 * One remark is asked at a time, in the order they were made, as the prototype's `pump` did: an
 * answer is tried out against the document as it stands, and two tried at once would each be
 * tried against a document the other is about to change.
 */

/** Why no answer came. */
export type Failure = ExpertFailure;

/** What is known of one remark's way through the expert. */
export interface Asked {
    /** Waiting its turn, or being read now. */
    turn: 'waiting' | 'asking' | null;
    /** What the expert says it is doing, while it is being read. */
    progress: string | null;
    /** What the expert asked earlier and what the reader answered, oldest first. */
    thread: readonly { question: string; answer: string }[];
    /** What the expert has to know first. */
    question: string | null;
    failure: Failure | null;
    /** An answer that has come and is not written into the document yet. */
    answer: { steps: Step[]; model: string } | null;
    /** Whether its steps have gone back once already for what the chain refused of them. */
    mended: boolean;
}

const UNASKED: Asked = { turn: null, progress: null, thread: [], question: null, failure: null, answer: null, mended: false };

/**
 * How one remark is asked: the desk's to say, since the request is made of the document and the
 * run it has in hand. Null where the remark is gone, or there is no one to ask.
 */
export type Driver = (
    id: string,
    asked: Asked,
    options: { mend?: readonly string[]; signal: AbortSignal; onProgress: (line: string) => void },
) => Promise<ExpertAnswer> | null;

export interface Asking {
    subscribe: (listener: () => void) => () => void;
    /** Every remark something is known of. A new map whenever anything changed. */
    read: () => ReadonlyMap<string, Asked>;
    /** Put a remark in line, to be read as if for the first time. */
    enqueue: (id: string) => void;
    /** Take a remark out of line, or stop the asking under way. */
    stop: (id: string) => void;
    /** The reader's answer to what the expert asked: into the thread, and asked again. */
    reply: (id: string, answer: string) => void;
    /**
     * Its answer is in the document. `errors` is what the chain said of the steps that did not
     * run: they go back for mending, once.
     */
    written: (id: string, errors: readonly string[]) => void;
    /** The remark is gone, or said anew: nothing known of it holds any longer. */
    forget: (id: string) => void;
    /** The desk came, and says how to ask; or left, and the line waits for it. */
    drive: (driver: Driver | null) => void;
    /** Whether a remark is being asked right now. */
    busy: () => boolean;
}

/** What an `ExpertError` says of itself, read without the class: the store loads no expert. */
const reasonOf = (thrown: unknown): ExpertFailure => {
    const reason = (thrown as { reason?: unknown } | null)?.reason;
    const known: readonly ExpertFailure[] = ['key', 'busy', 'declined', 'unreadable', 'stopped', 'failed'];
    return known.includes(reason as ExpertFailure) ? (reason as ExpertFailure) : 'failed';
};

/** @param idle called whenever an asking has ended and none has begun. */
const createAsking = (idle: () => void): Asking => {
    let entries: ReadonlyMap<string, Asked> = new Map();
    const listeners = new Set<() => void>();
    let line: { id: string; mend?: readonly string[] }[] = [];
    let working: { id: string; abort: AbortController } | null = null;
    let driver: Driver | null = null;

    const of = (id: string): Asked => entries.get(id) ?? UNASKED;
    const set = (id: string, change: Partial<Asked> | null) => {
        const next = new Map(entries);
        if (change === null) next.delete(id);
        else next.set(id, { ...of(id), ...change });
        entries = next;
        for (const listener of [...listeners]) listener();
    };

    const pump = () => {
        if (working || !driver) return;
        const next = line.shift();
        if (!next) return;
        const { id, mend } = next;
        const abort = new AbortController();
        // The question it is being asked again over stands until there is an answer to it.
        const before = of(id);
        set(id, { turn: 'asking', progress: null, failure: null });
        const asking = driver(id, before, {
            ...(mend && { mend }),
            signal: abort.signal,
            onProgress: (progress) => {
                if (working?.abort === abort) set(id, { progress });
            },
        });
        if (!asking) {
            set(id, { turn: null });
            pump();
            return;
        }
        working = { id, abort };
        const ended = (change: Partial<Asked>) => {
            // Forgotten meanwhile: there is no remark left for the answer to be about.
            const mine = working?.abort === abort;
            if (mine) working = null;
            if (mine && entries.has(id)) set(id, { turn: null, progress: null, ...change });
            pump();
            if (!working) idle();
        };
        asking.then(
            (answer) =>
                ended(
                    answer.question !== null && answer.question.trim() !== ''
                        ? { question: answer.question }
                        : { question: null, answer: { steps: answer.steps, model: answer.model }, mended: mend !== undefined },
                ),
            (thrown: unknown) => ended({ failure: abort.signal.aborted ? 'stopped' : reasonOf(thrown) }),
        );
    };

    const unqueue = (id: string) => {
        line = line.filter((waiting) => waiting.id !== id);
    };

    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        read: () => entries,
        enqueue: (id) => {
            if (working?.id === id || line.some((waiting) => waiting.id === id)) return;
            line.push({ id });
            set(id, { turn: 'waiting', failure: null, mended: false });
            pump();
        },
        stop: (id) => {
            if (working?.id === id) {
                working.abort.abort();
                return;
            }
            if (!line.some((waiting) => waiting.id === id)) return;
            unqueue(id);
            set(id, { turn: null, failure: 'stopped' });
        },
        reply: (id, answer) => {
            const { question, thread } = of(id);
            if (question === null) return;
            set(id, { thread: [...thread, { question, answer }], question: null });
            unqueue(id);
            line.push({ id });
            set(id, { turn: 'waiting', failure: null });
            pump();
        },
        written: (id, errors) => {
            const { answer, mended } = of(id);
            if (answer === null) return;
            set(id, { answer: null });
            if (errors.length === 0 || mended) return;
            // Marked now, not when the mended answer comes: one that never comes is not asked for twice.
            unqueue(id);
            line.push({ id, mend: errors });
            set(id, { turn: 'waiting', mended: true });
            pump();
        },
        forget: (id) => {
            unqueue(id);
            const mine = working?.id === id ? working : null;
            if (entries.has(id)) set(id, null);
            mine?.abort.abort();
        },
        drive: (next) => {
            driver = next;
            pump();
        },
        busy: () => working !== null,
    };
};

/**
 * What outlasts the desk: the line of remarks being asked, and the description client they are
 * tried out on.
 *
 * The desk has one client for as long as it is open. It is the session's rather than the desk's
 * own because an asking begun on the desk goes on while the reader looks at another, and tries
 * its steps out meanwhile. So the client is let go when the desk has gone *and* nothing is being
 * asked, whichever comes last.
 */
export interface DescribeSession {
    asking: Asking;
    /** The client, started with the first call. The desk takes it when it opens. */
    open: () => DescriptionClient;
    /** The desk has closed. */
    close: () => void;
    /**
     * The states of the document a run's result has been written over.
     *
     * Undo brings such a state back as the very array it was, and it is then left as the reader
     * asked for it: written over again, the step just undone would be made anew every time, and
     * nothing before it could be reached.
     */
    written: WeakSet<readonly unknown[]>;
}

export const createSession = (createClient: () => DescriptionClient): DescribeSession => {
    let client: DescriptionClient | null = null;
    let desks = 0;
    const rest = () => {
        if (desks > 0 || asking.busy()) return;
        client?.dispose();
        client = null;
    };
    const asking = createAsking(rest);
    const held = () => (client ??= createClient());
    return {
        asking,
        written: new WeakSet(),
        open: () => {
            desks += 1;
            // Not the client itself: one let go while an asking was still to try its steps out is
            // started again by the next call, as the client's own contract has it.
            return {
                describe: (...request) => held().describe(...request),
                bringOut: (...request) => held().bringOut(...request),
                dispose: () => undefined,
            };
        },
        close: () => {
            desks = Math.max(0, desks - 1);
            rest();
        },
    };
};
