import { useEffect, useMemo, useRef, useState } from 'react';
import type { DescriptionClient, DescriptionRun } from '../../fitting/description/client';
import type { AlignmentData } from '../../fitting/fit.worker';
import { useLatest } from '../../hooks/useLatest';
import type { Call } from '../../model/Work';
import type { Asked } from './asking';
import { answered, migrated, runKey } from './document';

/** The calls that edit the recording by hand: what there is of a document with nothing described. */
const GROUND = new Set(['ProcessVoices', 'MakeChoice', 'CorrectPedal', 'Modify']);

/** A remark no document holds, tried with no steps: how a run of its own is asked of the client. */
const NOTHING_SAID = { remark: 'describe-desk:nothing-described', steps: [] };

const NOTHING_RAN: readonly Call[] = [];

interface Ran {
    run: DescriptionRun;
    key: string;
    alignment: AlignmentData;
    /** The document the run was made of. */
    of: readonly Call[];
}

interface DescriptionOptions {
    /** The alignment as loaded; null until a score is open. */
    alignment: AlignmentData | null;
    /** The document's calls as they stand. */
    calls: readonly Call[];
    /** What is known of the remarks being asked: an answer among it is run before it is written. */
    asked: ReadonlyMap<string, Asked>;
    client: DescriptionClient;
    /**
     * A run is in, of the document `made`: write what it came to. Called once for every run, and
     * again whenever the document changes into one the same run still answers.
     */
    onRun: (made: readonly Call[], run: DescriptionRun) => void;
    /**
     * An answer has been tried on the document `made`: `run` is the document as it would stand
     * with the answer written, and says what of the calls made by hand it would displace.
     *
     * @returns the document as it stands where the answer was written there and then, which the
     * trial's run is then taken for the run of; null where nothing was written.
     */
    onTried: (made: readonly Call[], tried: Tried) => readonly Call[] | null;
    /** An answer could not be tried at all. */
    onUntried: (id: string, answer: Answer) => void;
}

type Answer = NonNullable<Asked['answer']>;

/** An answer tried on the document. */
export interface Tried {
    /** The remark it answers. */
    id: string;
    answer: Answer;
    run: DescriptionRun;
    /** What the document it was tried on is told by. */
    key: string;
    alignment: AlignmentData;
}

interface Description {
    /** The last run that came in; null until the first has. */
    run: DescriptionRun | null;
    /**
     * The document `run` was made of. While the run stands, what was made by hand in it is what
     * the document still holds: a call made by hand is part of what a run is a function of.
     */
    ran: readonly Call[];
    /** The same document with nothing described: what the match is measured against. */
    bare: DescriptionRun | null;
    /** The document as `run` was made of it or the next will be: remarks read, answers in place. */
    made: readonly Call[];
    /** What a run of `made` is a function of, as one string; see `runKey`. */
    key: string;
    /** A run is under way, and `run` is of a document since changed. */
    stale: boolean;
    /** Why the document as it stands could not be run. */
    problem: string | null;
    /**
     * Take a run for the run of a document about to be written: a trial's, whose run is the
     * document as it stands once the answer is in. Without it the document just written would be
     * run again, to learn what the trial has just said.
     */
    adopt: (run: DescriptionRun, of: readonly Call[]) => void;
}

/**
 * The document, run: whenever its calls or the alignment change, and once more for every answer
 * the expert gives.
 *
 * ## An answer is run before it is written
 *
 * The steps an answer brings resolve to calls only a run can name. Written first and resolved
 * after, a remark would be two edits, and one step of undo would leave its steps in the document
 * without the calls they came to. So an answer is run first, and written with what it came to.
 *
 * It is run **on trial**, where it is later than every call made by hand and takes their place:
 * that says what it would displace (`onTried`), which is the reader's to allow. One the reader
 * has said to keep behind those calls is put in place in memory instead and run with the
 * document, and `onRun` writes steps and calls together. An answer the reader has not spoken on
 * is in neither: the document is run as it stands, without it.
 *
 * ## A run is not repeated for a document it already answers
 *
 * Writing a run's result changes the document, which would ask for the run again: two and a half
 * seconds over the published reconstruction, to learn what is already known. What a run is a
 * function of is spelled as one string (`runKey`), in which the calls a remark owns do not
 * appear. While that string stands, so does the run, and `onRun` is handed it again as it is.
 */
export const useDescription = ({ alignment, calls, asked, client, onRun, onTried, onUntried }: DescriptionOptions): Description => {
    const [ran, setRan] = useState<Ran | null>(null);
    const [bare, setBare] = useState<Omit<Ran, 'of'> | null>(null);
    const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

    const made = useMemo(() => {
        let next = migrated(calls);
        asked.forEach(({ answer, kept }, id) => {
            if (answer && kept) next = answered(next, id, answer);
        });
        return next;
    }, [calls, asked]);
    const key = useMemo(() => runKey(made), [made]);
    /**
     * The remarks with an answer waiting to be written behind what was made by hand. An answer
     * can say again what its remark already holds, and then the document it makes is one the last
     * run already answers: that the answer came is the only thing that changed, and it still has
     * to be taken.
     */
    const awaited = useMemo(
        () =>
            [...asked]
                .flatMap(([id, { answer, kept }]) => (answer && kept ? [id] : []))
                .sort()
                .join(' '),
        [asked],
    );
    /** The answer to try next: one that has come and has not been tried on the document as it stands. */
    const untried = useMemo(() => [...asked].find(([, entry]) => entry.answer !== null && !entry.kept && entry.displacing === null), [asked]);
    const tryId = untried?.[0] ?? null;
    const tryAnswer = untried?.[1].answer ?? null;

    const madeRef = useLatest(made);
    const onRunRef = useLatest(onRun);
    const onTriedRef = useLatest(onTried);
    const onUntriedRef = useLatest(onUntried);
    /** The last run, for the effect to find without running again because it has come. */
    const last = useRef<Ran | null>(null);

    const adopt = (run: DescriptionRun, of: readonly Call[]) => {
        if (!alignment) return;
        last.current = { run, key: runKey(of), alignment, of };
        setRan(last.current);
        setFailed(null);
    };
    const adoptRef = useLatest(adopt);

    useEffect(() => {
        if (!alignment) return;
        const known = last.current;
        if (known && known.key === key && known.alignment === alignment) {
            onRunRef.current(madeRef.current, known.run);
            return;
        }
        let overtaken = false;
        const of = madeRef.current;
        client.describe(alignment, of).then(
            (run) => {
                if (overtaken) return;
                last.current = { run, key, alignment, of };
                setRan(last.current);
                setFailed(null);
                onRunRef.current(madeRef.current, run);
            },
            (thrown: unknown) => {
                if (overtaken) return;
                setFailed({ key, message: thrown instanceof Error ? thrown.message : String(thrown) });
            },
        );
        return () => {
            overtaken = true;
        };
        // `made` and `onRun` through refs: what a run depends on of them is in `key`.
    }, [alignment, key, awaited, client, madeRef, onRunRef]);

    // An answer on trial. One at a time: each is tried on the document as it stands, and the
    // one before it may be written into that. The identity of the answer stands for the answer.
    useEffect(() => {
        if (!alignment || tryId === null || tryAnswer === null) return;
        let overtaken = false;
        client.describe(alignment, madeRef.current, { trial: { remark: tryId, steps: tryAnswer.steps } }).then(
            (run) => {
                if (overtaken) return;
                const written = onTriedRef.current(madeRef.current, { id: tryId, answer: tryAnswer, run, key, alignment });
                if (written) adoptRef.current(run, written);
            },
            () => {
                if (!overtaken) onUntriedRef.current(tryId, tryAnswer);
            },
        );
        return () => {
            overtaken = true;
        };
        // `made` through a ref: what a trial depends on of it is in `key`.
    }, [alignment, key, tryId, tryAnswer, client, madeRef, onTriedRef, onUntriedRef, adoptRef]);

    // The same recording with nothing said of it. Asked as a trial, which the client always runs
    // by itself: a plain request made beside the one above would be answered with that one's run.
    const ground = useMemo(() => calls.filter((call) => GROUND.has(call.name)), [calls]);
    const groundKey = useMemo(() => runKey(ground), [ground]);
    const groundRef = useLatest(ground);
    useEffect(() => {
        if (!alignment) return;
        let overtaken = false;
        client.describe(alignment, groundRef.current, { trial: NOTHING_SAID }).then(
            (run) => {
                if (!overtaken) setBare({ run, key: groundKey, alignment });
            },
            () => {
                // The run above says why, of the same recording.
            },
        );
        return () => {
            overtaken = true;
        };
    }, [alignment, groundKey, client, groundRef]);

    const current = ran !== null && ran.alignment === alignment;
    return {
        run: current ? ran.run : null,
        ran: current ? ran.of : NOTHING_RAN,
        bare: bare !== null && bare.alignment === alignment && bare.key === groundKey ? bare.run : null,
        made,
        key,
        stale: !current || ran.key !== key,
        problem: failed !== null && failed.key === key ? failed.message : null,
        adopt,
    };
};
