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

interface Ran {
    run: DescriptionRun;
    key: string;
    alignment: AlignmentData;
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
}

export interface Description {
    /** The last run that came in; null until the first has. */
    run: DescriptionRun | null;
    /** The same document with nothing described: what the match is measured against. */
    bare: DescriptionRun | null;
    /** The document as `run` was made of it or the next will be: remarks read, answers in place. */
    made: readonly Call[];
    /** A run is under way, and `run` is of a document since changed. */
    stale: boolean;
    /** Why the document as it stands could not be run. */
    problem: string | null;
}

/**
 * The document, run: whenever its calls or the alignment change, and once more for every answer
 * the expert gives.
 *
 * ## An answer is run before it is written
 *
 * The steps an answer brings resolve to calls only a run can name. Written first and resolved
 * after, a remark would be two edits, and one step of undo would leave its steps in the document
 * without the calls they came to. So the answer is put in place in memory, that is run, and
 * `onRun` writes steps and calls together.
 *
 * ## A run is not repeated for a document it already answers
 *
 * Writing a run's result changes the document, which would ask for the run again: two and a half
 * seconds over the published reconstruction, to learn what is already known. What a run is a
 * function of is spelled as one string (`runKey`), in which the calls a remark owns do not
 * appear. While that string stands, so does the run, and `onRun` is handed it again as it is.
 */
export const useDescription = ({ alignment, calls, asked, client, onRun }: DescriptionOptions): Description => {
    const [ran, setRan] = useState<Ran | null>(null);
    const [bare, setBare] = useState<Ran | null>(null);
    const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

    const made = useMemo(() => {
        let next = migrated(calls);
        for (const [id, { answer }] of asked) if (answer) next = answered(next, id, answer);
        return next;
    }, [calls, asked]);
    const key = useMemo(() => runKey(made), [made]);

    const madeRef = useLatest(made);
    const onRunRef = useLatest(onRun);
    /** The last run, for the effect to find without running again because it has come. */
    const last = useRef<Ran | null>(null);

    useEffect(() => {
        if (!alignment) return;
        const known = last.current;
        if (known && known.key === key && known.alignment === alignment) {
            onRunRef.current(madeRef.current, known.run);
            return;
        }
        let overtaken = false;
        client.describe(alignment, madeRef.current).then(
            (run) => {
                if (overtaken) return;
                last.current = { run, key, alignment };
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
    }, [alignment, key, client, madeRef, onRunRef]);

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
        bare: bare !== null && bare.alignment === alignment && bare.key === groundKey ? bare.run : null,
        made,
        stale: !current || ran.key !== key,
        problem: failed !== null && failed.key === key ? failed.message : null,
    };
};
