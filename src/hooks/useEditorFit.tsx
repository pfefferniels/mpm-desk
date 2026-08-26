import { useEffect, useMemo, useRef, useState } from 'react';
import { Alignment } from '../fitting/alignment';
import { parseMPM, type Mpm } from '../fitting/instructions/index';
import type { InstructionType } from '../fitting/instructions/index';
import { deriveResidual, type Residual } from '../fitting/residual';
import type { FitResult } from '../fitting/fit';
import type { FitReply, FitRequest } from '../fitting/fit.worker';
import type { WorkFile } from '../model/Work';

/**
 * Running the chain for the editor, and giving the desks what they draw against.
 *
 * ## Why the objects are rebuilt on this side
 *
 * The fold runs in a worker — three seconds on the shipped reconstruction — and hands back plain
 * data: the MPM as XML, the alignment as flat records. The desks want neither. They want an
 * `Alignment` they can ask `asChords(part)` and an `Mpm` they can read instructions out of, so
 * both are rebuilt here from what crossed. Parsing the MPM costs about ten milliseconds against
 * three seconds of fitting, which is not a boundary worth avoiding.
 *
 * ## The residual is per desk, and that is a correctness matter
 *
 * A desk plotting a residual is plotting *what its own dimension still has to account for*, which
 * is only that quantity if its own dimension is held out of the probe. `DeskSwitch.tsx` declares
 * the hold-out per desk and it arrives here as `holdOut`.
 *
 * Deriving one renders the whole document, so it is memoised on the run and the hold-out — a desk
 * switch costs one render, and drawing does not cost any. Two desks with the same hold-out share
 * the work.
 *
 * ## Staleness
 *
 * Every request carries an id and every reply echoes it. A three-second fit is routinely
 * overtaken by the next gesture, and an overtaken reply is not late but wrong: it describes a
 * document that has already been edited past. A running fold cannot be interrupted, so the guard
 * is on this side, which is the only place it can be.
 *
 * While a newer fit is running the last finished one stays on screen and `pending` says so.
 * Blanking every desk for three seconds after each gesture would make the editor unusable.
 */
export interface EditorFit {
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
                timeSignature: pristine.timeSignature,
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
     */
    const chainKey = useMemo(
        () => JSON.stringify({ provenance: work.provenance, segments: work.segments }),
        [work.provenance, work.segments],
    );

    const workRef = useRef(work);
    workRef.current = work;

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
    }, [chainKey, ready]);

    const mpm = useMemo(() => (result ? parseMPM(result.mpm) : null), [result]);

    const alignment = useMemo(() => {
        if (!result) return null;
        const rebuilt = new Alignment(result.ground.notes, result.ground.timeSignature);
        rebuilt.pedals = result.ground.pedals;
        return rebuilt;
    }, [result]);

    const holdOutKey = holdOut?.join(',') ?? '';
    const residual = useMemo(() => {
        if (!alignment || !mpm) return null;
        return deriveResidual(alignment, mpm, {
            ...(holdOut?.length ? { without: holdOut } : {}),
        });
        // `holdOutKey` rather than `holdOut`: the registry hands over a fresh array literal on
        // every render, and depending on it would re-derive — a whole render of the document —
        // on every keystroke in a desk.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [alignment, mpm, holdOutKey]);

    return { result, mpm, alignment, residual, pending, problems, error };
};
