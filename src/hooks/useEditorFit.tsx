import { useEffect, useMemo, useRef, useState } from 'react';
import { Alignment } from '../fitting/alignment';
import { parseMPM, type Mpm } from '../fitting/instructions/index';
import type { InstructionType } from '../fitting/instructions/index';
import { deriveResidual, type Residual } from '../fitting/residual';
import type { FitResult } from '../fitting/fit';
import { isDocumentCall } from '../fitting/chain';
import type { FitReply, FitRequest } from '../fitting/fit.worker';
import type { WorkFile } from '../model/Work';
import { useLatest } from './useLatest';

/**
 * Running the chain for the editor, and giving the desks what they draw against.
 *
 * The fold runs in a worker, three seconds on the shipped reconstruction, and hands back plain
 * data: the MPM as XML, the alignment as flat records. The desks want an `Alignment` they can ask
 * `in(part).chords()` and an `Mpm` they can read instructions out of, so both are rebuilt here.
 * Parsing the MPM costs about ten milliseconds against three seconds of fitting.
 *
 * ## The residual is per desk, and that is a correctness matter
 *
 * A desk plotting a residual plots *what its own dimension still has to account for*, which is
 * only that quantity if its own dimension is held out of the probe. `DeskSwitch.tsx` declares the
 * hold-out per desk and it arrives here as `holdOut`.
 *
 * Deriving one renders the whole document, so it is memoised on the run and the hold-out: a desk
 * switch costs one render and drawing costs none, and two desks with the same hold-out share the
 * work.
 *
 * ## Staleness
 *
 * Every request carries an id and every reply echoes it. A three-second fit is routinely
 * overtaken by the next gesture, and an overtaken reply is wrong rather than late, describing a
 * document already edited past. A running fold cannot be interrupted, so the guard is here.
 *
 * While a newer fit runs the last finished one stays on screen and `pending` says so. Blanking
 * every desk for three seconds after each gesture would make the editor unusable.
 */
interface EditorFit {
    result: FitResult | null;
    /** The performance the chain wrote, parsed once. */
    mpm: Mpm | null;
    /** The recording as the chain left it, rebuilt as an `Alignment`. */
    alignment: Alignment | null;
    /** What the MPM does not explain, with the open desk's own dimension held out. */
    residual: Residual | null;
    /** A newer fit is running; what is on screen is the one before it. */
    pending: boolean;
    problems: readonly string[] | null;
    error: string | null;
}

interface UseEditorFitParams {
    work: WorkFile;
    /** The alignment as loaded, never run over. Null until an MEI is open. */
    pristine: Alignment | null;
    holdOut: readonly InstructionType[] | undefined;
}

export const useEditorFit = ({ work, pristine, holdOut }: UseEditorFitParams): EditorFit => {
    const [result, setResult] = useState<FitResult | null>(null);
    const [pending, setPending] = useState(false);
    const [ready, setReady] = useState(false);
    const [problems, setProblems] = useState<readonly string[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const workerRef = useRef<Worker | null>(null);
    const nextRequestId = useRef(0);
    const awaiting = useRef(-1);

    useEffect(() => {
        if (!pristine) return;

        const worker = new Worker(new URL('../fitting/fit.worker.ts', import.meta.url), {
            type: 'module',
        });
        workerRef.current = worker;

        worker.onmessage = (event: MessageEvent<FitReply>) => {
            const reply = event.data;
            if (reply.type === 'loaded') {
                setReady(true);
                return;
            }
            if (reply.requestId !== awaiting.current) return;

            setPending(false);
            if (reply.type === 'fitted') {
                setResult(reply.result);
                setProblems(null);
                setError(null);
            } else if (reply.type === 'chain-invalid') {
                setProblems(reply.problems);
            } else {
                setError(reply.message);
            }
        };

        worker.postMessage({
            type: 'load',
            requestId: nextRequestId.current++,
            alignment: {
                allNotes: pristine.allNotes,
                pedals: pristine.pedals,
                timeSignatures: pristine.timeSignatures,
            },
        } satisfies FitRequest);

        return () => {
            worker.terminate();
            workerRef.current = null;
            // A fresh worker has been sent no alignment; saying otherwise would let the next fit
            // be requested before there is anything to fit against.
            setReady(false);
        };
    }, [pristine]);

    /**
     * The part of the document the chain is a function of.
     *
     * `secondary` is deliberately absent: it is the desks' own working state — the skyline's
     * boxes, the hand-marked silent onsets, the drawn trails — and none of it reaches the chain.
     * A refit on every stroke of a drawn curve would cost three seconds and produce byte for byte
     * the same document.
     *
     * So are the calls the chain does not run. An `Align` records what a reader decided about the
     * score and the recording disagreeing, and that decision reaches the fit through the MEI it
     * was written into — which arrives here as a new `pristine` and reloads the worker. Left in,
     * every one of forty divergences settled in a review would cost a three-second fold and
     * produce the same document each time.
     */
    const chainKey = useMemo(
        () =>
            JSON.stringify({
                provenance: work.provenance.filter((call) => !isDocumentCall(call.name)),
                segments: work.segments,
            }),
        [work.provenance, work.segments],
    );

    const workRef = useLatest(work);

    useEffect(() => {
        const worker = workerRef.current;
        if (!worker || !ready) return;
        const requestId = nextRequestId.current++;
        awaiting.current = requestId;
        setPending(true);
        worker.postMessage({
            type: 'fit',
            requestId,
            work: workRef.current,
        } satisfies FitRequest);
    }, [chainKey, ready, workRef]);

    const mpm = useMemo(() => (result ? parseMPM(result.mpm) : null), [result]);

    const alignment = useMemo(() => {
        if (!result) return null;
        const rebuilt = new Alignment(result.ground.notes, result.ground.timeSignatures);
        rebuilt.pedals = result.ground.pedals;
        return rebuilt;
    }, [result]);

    /**
     * The hold-out, as one value that only changes when the hold-out does.
     *
     * The registry hands over a fresh array literal on every render, so depending on the array
     * would re-derive the residual, a whole render of the document, on every keystroke in a desk.
     * Going through the joined key and back makes the identity follow the content.
     *
     * Rebuilt from the key rather than read through an `exhaustive-deps` disable: the React
     * Compiler refuses to optimize any component or hook in a file where a React lint rule is
     * switched off, so one suppression here would opt the editor's central hook out entirely.
     */
    const holdOutKey = holdOut?.join(',') ?? '';
    const without = useMemo(
        () => (holdOutKey ? (holdOutKey.split(',') as InstructionType[]) : undefined),
        [holdOutKey],
    );

    const residual = useMemo(() => {
        if (!alignment || !mpm) return null;
        // None to be had while the readings stand side by side — `deriveResidual` refuses to
        // measure one take against another. Every desk that reads a residual is greyed out until
        // a base text has been chosen, so nothing on screen is left without one.
        if (alignment.unchosenNotes() > 0) return null;
        return deriveResidual(alignment, mpm, without ? { without } : {});
    }, [alignment, mpm, without]);

    return { result, mpm, alignment, residual, pending, problems, error };
};
