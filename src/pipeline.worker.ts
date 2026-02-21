import {
    MSM, MPM,
    InsertMetadata, InsertDynamicsInstructions, InsertDynamicsGradient,
    InsertTemporalSpread, InsertRubato, ApproximateLogarithmicTempo,
    InsertMetricalAccentuation, InsertPedal, CombineAdjacentRubatos,
    StylizeOrnamentation, StylizeArticulation, TranslatePhyiscalTimeToTicks,
    MergeMetricalAccentuations, InsertArticulation, MakeChoice, Modify,
    compareTransformers, validate
} from 'mpmify';
import type { Transformer, Argumentation, TransformationOptions } from 'mpmify/lib/transformers/Transformer';

interface SerializedTransformer {
    id: string;
    name: string;
    options: unknown;
    created: string[];
    argumentation: Argumentation;
}

export interface RunPipelineMessage {
    type: 'run-pipeline';
    requestId: number;
    transformers: SerializedTransformer[];
    msm: {
        allNotes: ReturnType<MSM['allNotes']['slice']>;
        pedals: ReturnType<MSM['pedals']['slice']>;
        timeSignature: MSM['timeSignature'];
    };
    metadata: { author: string; title: string };
}

function reconstructTransformer(t: SerializedTransformer): Transformer | null {
    let transformer: Transformer | null = null;

    if (t.name === 'MakeChoice') transformer = new MakeChoice();
    else if (t.name === 'Modify') transformer = new Modify(
        t.options as ConstructorParameters<typeof Modify>[0]
    );
    else if (t.name === 'InsertDynamicsInstructions') transformer = new InsertDynamicsInstructions();
    else if (t.name === 'InsertDynamicsGradient') transformer = new InsertDynamicsGradient();
    else if (t.name === 'InsertTemporalSpread') transformer = new InsertTemporalSpread();
    else if (t.name === 'InsertRubato') transformer = new InsertRubato();
    else if (t.name === 'ApproximateLogarithmicTempo') transformer = new ApproximateLogarithmicTempo();
    else if (t.name === 'InsertMetricalAccentuation') transformer = new InsertMetricalAccentuation();
    else if (t.name === 'InsertPedal') transformer = new InsertPedal();
    else if (t.name === 'CombineAdjacentRubatos') transformer = new CombineAdjacentRubatos();
    else if (t.name === 'StylizeOrnamentation') transformer = new StylizeOrnamentation();
    else if (t.name === 'StylizeArticulation') transformer = new StylizeArticulation();
    else if (t.name === 'TranslatePhyiscalTimeToTicks') transformer = new TranslatePhyiscalTimeToTicks();
    else if (t.name === 'MergeMetricalAccentuations') transformer = new MergeMetricalAccentuations();
    else if (t.name === 'InsertArticulation') transformer = new InsertArticulation();
    else if (t.name === 'InsertMetadata') transformer = new InsertMetadata();
    else {
        console.warn(`Unknown transformer: ${t.name}`);
        return null;
    }

    transformer.id = t.id;
    transformer.options = t.options as TransformationOptions;
    transformer.argumentation = t.argumentation;
    transformer.created = t.created;
    return transformer;
}

self.onmessage = (event: MessageEvent<RunPipelineMessage>) => {
    const { type, requestId, transformers, msm, metadata } = event.data;
    if (type !== 'run-pipeline') return;

    try {
        // Reconstruct MSM from plain data
        const initialMSM = new MSM();
        initialMSM.allNotes = msm.allNotes;
        initialMSM.pedals = msm.pedals;
        initialMSM.timeSignature = msm.timeSignature;

        // Reconstruct transformer instances from serialized data
        const reconstructed = transformers
            .map(reconstructTransformer)
            .filter((t): t is Transformer => t !== null);

        // Create metadata transformer (same logic as App.tsx)
        const metadataTransformer = new InsertMetadata({
            authors: metadata.author ? [{ number: 0, text: metadata.author }] : [],
            comments: metadata.title ? [{ text: metadata.title }] : []
        });
        metadataTransformer.argumentation = {
            note: '',
            id: 'argumentation-metadata',
            conclusion: {
                certainty: 'authentic',
                id: 'belief-metadata',
                motivation: 'calm'
            },
            type: 'simpleArgumentation'
        };

        const allTransformers = [metadataTransformer, ...reconstructed].sort(compareTransformers);

        const messages = validate(allTransformers);
        if (messages.length) {
            self.postMessage({
                type: 'validation-error',
                requestId,
                messages: messages.map(m => m.message)
            });
            return;
        }

        // Run the pipeline
        const newMPM = new MPM();
        const newMSM = initialMSM.deepClone();
        allTransformers.forEach(t => t.run(newMSM, newMPM));

        // Collect updated created arrays to sync back
        const created: Record<string, string[]> = {};
        allTransformers.forEach(t => { created[t.id] = t.created; });

        self.postMessage({
            type: 'pipeline-result',
            requestId,
            msm: {
                allNotes: newMSM.allNotes,
                pedals: newMSM.pedals,
                timeSignature: newMSM.timeSignature
            },
            mpmDoc: newMPM.doc,
            created
        });
    } catch (error) {
        self.postMessage({
            type: 'pipeline-error',
            requestId,
            error: error instanceof Error ? error.message : String(error)
        });
    }
};
