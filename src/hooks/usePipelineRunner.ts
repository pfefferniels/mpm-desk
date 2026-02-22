import { Argumentation, MPM, MSM, Transformer } from 'mpmify';
import { Dispatch, SetStateAction, useEffect, useRef } from 'react';
import { useLatest } from './useLatest';

interface PipelineMetadata {
    author: string;
    title: string;
}

interface SerializedTransformer {
    id: string;
    name: string;
    options: unknown;
    created: string[];
    argumentation: Argumentation;
}

interface PipelineResultMessage {
    type: 'pipeline-result';
    requestId: number;
    msm: {
        allNotes: MSM['allNotes'];
        pedals: MSM['pedals'];
        timeSignature: MSM['timeSignature'];
    };
    mpmDoc: MPM['doc'];
    created: Record<string, string[]>;
}

interface ValidationErrorMessage {
    type: 'validation-error';
    requestId: number;
    messages: string[];
}

interface PipelineErrorMessage {
    type: 'pipeline-error';
    requestId: number;
    error: string;
}

type PipelineWorkerMessage = PipelineResultMessage | ValidationErrorMessage | PipelineErrorMessage;

interface UsePipelineRunnerParams {
    initialMSM: MSM;
    transformers: Transformer[];
    metadata: PipelineMetadata;
    setTransformers: Dispatch<SetStateAction<Transformer[]>>;
    setMSM: Dispatch<SetStateAction<MSM>>;
    setMPM: Dispatch<SetStateAction<MPM>>;
    onValidationError?: (messages: string[]) => void;
    onPipelineError?: (error: string) => void;
    onPipelineSuccess?: () => void;
}

const equalIds = (left: string[], right: string[]) => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
};

const cloneTransformerWithCreated = (transformer: Transformer, created: string[]) => {
    const clone = Object.create(Object.getPrototypeOf(transformer)) as Transformer;
    Object.assign(clone, transformer, { created });
    return clone;
};

export const usePipelineRunner = ({
    initialMSM,
    transformers,
    metadata,
    setTransformers,
    setMSM,
    setMPM,
    onValidationError,
    onPipelineError,
    onPipelineSuccess,
}: UsePipelineRunnerParams) => {
    const workerRef = useRef<Worker>(null);
    const requestIdRef = useRef(0);
    const onValidationErrorRef = useLatest(onValidationError);
    const onPipelineErrorRef = useLatest(onPipelineError);
    const onPipelineSuccessRef = useLatest(onPipelineSuccess);

    useEffect(() => {
        workerRef.current = new Worker(new URL('../pipeline.worker.ts', import.meta.url), { type: 'module' });
        return () => workerRef.current?.terminate();
    }, []);

    useEffect(() => {
        if (initialMSM.allNotes.length === 0) return;
        if (!workerRef.current) return;

        const requestId = ++requestIdRef.current;
        const serialized: SerializedTransformer[] = transformers.map(transformer => ({
            id: transformer.id,
            name: transformer.name,
            options: transformer.options,
            created: transformer.created,
            argumentation: transformer.argumentation,
        }));

        workerRef.current.postMessage({
            type: 'run-pipeline',
            requestId,
            transformers: serialized,
            msm: {
                allNotes: initialMSM.allNotes,
                pedals: initialMSM.pedals,
                timeSignature: initialMSM.timeSignature,
            },
            metadata,
        });

        const handler = (event: MessageEvent<PipelineWorkerMessage>) => {
            const data = event.data;
            if (data.requestId !== requestIdRef.current) return;
            workerRef.current?.removeEventListener('message', handler as EventListener);

            if (data.type === 'pipeline-result') {
                const newMSM = new MSM();
                newMSM.allNotes = data.msm.allNotes;
                newMSM.pedals = data.msm.pedals;
                newMSM.timeSignature = data.msm.timeSignature;

                const newMPM = new MPM();
                newMPM.doc = data.mpmDoc;

                setTransformers(prev => {
                    let changed = false;
                    const next = prev.map(transformer => {
                        const created = data.created[transformer.id];
                        if (!created || equalIds(transformer.created, created)) return transformer;
                        changed = true;
                        return cloneTransformerWithCreated(transformer, created);
                    });
                    return changed ? next : prev;
                });

                setMPM(newMPM);
                setMSM(newMSM);
                onPipelineSuccessRef.current?.();
                return;
            }

            if (data.type === 'validation-error') {
                onValidationErrorRef.current?.(data.messages);
                return;
            }

            onPipelineErrorRef.current?.(data.error);
        };

        workerRef.current.addEventListener('message', handler as EventListener);
        return () => workerRef.current?.removeEventListener('message', handler as EventListener);
    }, [
        transformers,
        initialMSM,
        metadata,
        setTransformers,
        setMSM,
        setMPM,
        onValidationErrorRef,
        onPipelineErrorRef,
        onPipelineSuccessRef,
    ]);
};
