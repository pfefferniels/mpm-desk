import type { DescriptionClient, DescriptionRun, Step } from '../../fitting/description/client';
import type { ExpertAnswer, ExpertFailure } from './expert';

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
 *
 * ## An answer on its way into the document
 *
 * An answer is tried before it is written, and three things can be true of it meanwhile:
 *
 * - **Being tried**: neither `displacing` nor `kept`. The line waits; it does not take long.
 * - **Waiting for the reader** (`displacing`): written as it is, it would take the place of calls
 *   made by hand, and whether it may is the reader's to say. That can take as long as the reader
 *   likes, so the line goes on past it, with the document as it stands.
 * - **Kept behind** (`kept`): the reader said to keep what was made by hand. It is written to
 *   stand behind those calls, which is a run of the document as any other; the line waits.
 */

/** Why no answer came. */
export type Failure = ExpertFailure;

/**
 * An answer tried on the document, where it would take the place of calls made by hand: what the
 * reader is asked about, and what "replace" is written from.
 */
export interface Trial {
    /** The document as it would stand; the remark's report in it says what it displaces. */
    run: DescriptionRun;
    /** What the document it was tried on is told by: its `runKey`, and the score it was run against. */
    key: string;
    score: object;
}

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
    /** The answer's trial, where the reader is asked before it is written; null otherwise. */
    displacing: Trial | null;
    /** The reader said to keep what the answer would displace: it is written to stand behind it. */
    kept: boolean;
    /** Whether its steps have gone back once already for what the chain refused of them. */
    mended: boolean;
}

const UNASKED: Asked = {
    turn: null,
    progress: null,
    thread: [],
    question: null,
    failure: null,
    answer: null,
    displacing: null,
    kept: false,
    mended: false,
};

/** No answer on its way: what an entry is set to when one is written, dropped or asked for anew. */
const NO_ANSWER = { answer: null, displacing: null, kept: false } as const;

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
     * Its answer was tried, and would take the place of calls made by hand: the reader is asked,
     * and the line goes on meanwhile.
     */
    tried: (id: string, trial: Trial) => void;
    /** The document is no longer the one its answer was tried on: it is to be tried again. */
    retry: (id: string) => void;
    /** The reader's word on what the answer would displace: keep it, and write the answer behind it. */
    keep: (id: string) => void;
    /**
     * Its answer is in the document. `errors` is what the chain said of the steps that did not
     * run: they go back for mending, once.
     */
    written: (id: string, errors: readonly string[]) => void;
    /** Its answer could not be tried, and is let go. */
    dropped: (id: string) => void;
    /** The remark is gone, or said anew: nothing known of it holds any longer. */
    forget: (id: string) => void;
    /** The desk came, and says how to ask; or left, and the line waits for it. */
    drive: (driver: Driver | null) => void;
    /**
     * The document has taken in what was written to it: the next in line can be asked. Until
     * then it waits, since it is asked about the document, the last answer included.
     */
    resume: () => void;
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

    /** An answer being tried or written: the next is asked about the document with it in. */
    const unwritten = () => [...entries.values()].some((entry) => entry.answer !== null && entry.displacing === null);

    const pump = () => {
        if (working || !driver || unwritten()) return;
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
                        : { question: null, ...NO_ANSWER, answer: { steps: answer.steps, model: answer.model }, mended: mend !== undefined },
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
            // Asked anew: an answer still on its way, the reader's word on it included, is let go.
            set(id, { turn: 'waiting', failure: null, mended: false, ...NO_ANSWER });
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
        tried: (id, trial) => {
            const { answer, kept } = of(id);
            if (answer === null || kept) return;
            set(id, { displacing: trial });
            pump();
        },
        retry: (id) => {
            if (of(id).displacing !== null) set(id, { displacing: null });
        },
        keep: (id) => {
            if (of(id).displacing !== null) set(id, { displacing: null, kept: true });
        },
        written: (id, errors) => {
            const { answer, mended } = of(id);
            if (answer === null) return;
            set(id, NO_ANSWER);
            if (errors.length === 0 || mended) return;
            // Marked now, not when the mended answer comes: one that never comes is not asked for twice.
            unqueue(id);
            line.push({ id, mend: errors });
            set(id, { turn: 'waiting', mended: true });
        },
        dropped: (id) => {
            if (of(id).answer === null) return;
            set(id, { ...NO_ANSWER, failure: 'failed' });
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
        resume: pump,
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
    /** The client, started with the first call made of it and let go as said above. */
    client: DescriptionClient;
    /** The desk has opened, or closed. */
    open: () => void;
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
        // Not a client itself: one let go while nobody was there is started again by the next
        // call, as the client's own contract has it for its worker.
        client: {
            describe: (...request) => held().describe(...request),
            bringOut: (...request) => held().bringOut(...request),
            dispose: () => undefined,
        },
        open: () => {
            desks += 1;
        },
        close: () => {
            desks = Math.max(0, desks - 1);
            rest();
        },
    };
};
