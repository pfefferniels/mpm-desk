import { runPipeline } from './pipeline';
import type { PipelineInput, PipelineMetadata, SerializedTransformer } from './pipeline';

export interface RunPipelineMessage {
    type: 'run-pipeline';
    requestId: number;
    transformers: SerializedTransformer[];
    msm: PipelineInput;
    metadata: PipelineMetadata;
}

self.onmessage = (event: MessageEvent<RunPipelineMessage>) => {
    const { type, requestId, transformers, msm, metadata } = event.data;
    if (type !== 'run-pipeline') return;

    try {
        const outcome = runPipeline(transformers, msm, metadata);

        if (outcome.type === 'validation-error') {
            self.postMessage({ type: 'validation-error', requestId, messages: outcome.messages });
            return;
        }

        self.postMessage({
            type: 'pipeline-result',
            requestId,
            msm: {
                allNotes: outcome.msm.allNotes,
                pedals: outcome.msm.pedals,
                timeSignature: outcome.msm.timeSignature
            },
            // espressivo's document is a live XML tree, which structured clone cannot carry.
            // The serialization is the boundary — see pipelineBoundary.test.ts.
            mpm: outcome.mpm.toXML(),
            created: outcome.created
        });
    } catch (error) {
        self.postMessage({
            type: 'pipeline-error',
            requestId,
            error: error instanceof Error ? error.message : String(error)
        });
    }
};
