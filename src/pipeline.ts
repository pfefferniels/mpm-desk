import { MSM, MPM, InsertMetadata, createTransformer, compareTransformers, validate } from 'mpmify';
import type { Transformer, Argumentation, TransformationOptions } from 'mpmify';
import './transformers/register';

/**
 * The fold at the centre of the app: a chain of calls, an MSM, and one MPM written by running
 * every call in order.
 *
 * It lives here rather than inside `self.onmessage` so that it can be called — by tests, and by
 * anything else that needs the finished document without a worker. The worker is then only
 * message decoding.
 */

export interface SerializedTransformer {
    id: string;
    name: string;
    options: unknown;
    created: string[];
    argumentation: Argumentation;
}

export interface PipelineMetadata {
    author: string;
    title: string;
}

export interface PipelineInput {
    allNotes: MSM['allNotes'];
    pedals: MSM['pedals'];
    timeSignature: MSM['timeSignature'];
}

export type PipelineOutcome =
    | { type: 'result'; msm: MSM; mpm: MPM; created: Record<string, string[]> }
    | { type: 'validation-error'; messages: string[] };

/** An MSM carried across a worker boundary arrives as plain data; give it its methods back. */
export const asMSMInstance = (data: PipelineInput): MSM => {
    const msm = new MSM();
    msm.allNotes = data.allNotes;
    msm.pedals = data.pedals;
    msm.timeSignature = data.timeSignature;
    return msm;
};

/**
 * A serialized call is a name plus four fields. The registry owns the name → constructor map;
 * importing `./transformers/register` is what puts this app's own transformers into it.
 */
export const reconstructTransformer = (call: SerializedTransformer): Transformer | null => {
    const transformer = createTransformer(call.name);
    if (!transformer) {
        console.warn(`Unknown transformer: ${call.name}`);
        return null;
    }

    transformer.id = call.id;
    transformer.options = call.options as TransformationOptions;
    transformer.argumentation = call.argumentation;
    transformer.created = call.created;
    return transformer;
};

/** The metadata desk is not part of the chain, so its call is built fresh on every run. */
export const metadataTransformer = (metadata: PipelineMetadata): InsertMetadata => {
    const transformer = new InsertMetadata({
        authors: metadata.author ? [{ number: 0, text: metadata.author }] : [],
        comments: metadata.title ? [{ text: metadata.title }] : []
    });
    transformer.argumentation = {
        note: '',
        id: 'argumentation-metadata',
        conclusion: {
            certainty: 'authentic',
            id: 'belief-metadata',
            motivation: 'calm'
        },
        type: 'simpleArgumentation'
    };
    return transformer;
};

/**
 * Order the chain, check it, and run it over a *copy* of the MSM into a *fresh* MPM. Nothing
 * carries over between runs, which is what makes the result a function of the chain alone.
 */
export const runPipeline = (
    calls: SerializedTransformer[],
    input: PipelineInput,
    metadata: PipelineMetadata
): PipelineOutcome => {
    const chain = [
        metadataTransformer(metadata),
        ...calls.map(reconstructTransformer).filter((t): t is Transformer => t !== null)
    ].sort(compareTransformers);

    const messages = validate(chain);
    if (messages.length) {
        return { type: 'validation-error', messages: messages.map(m => m.message) };
    }

    const msm = asMSMInstance(input).deepClone();
    const mpm = new MPM();
    for (const transformer of chain) transformer.run(msm, mpm);

    const created: Record<string, string[]> = {};
    for (const transformer of chain) created[transformer.id] = transformer.created;

    return { type: 'result', msm, mpm, created };
};
