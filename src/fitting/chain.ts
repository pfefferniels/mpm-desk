/**
 * Turning a saved chain back into one that runs.
 *
 * This is the seam between the document and the pipeline, and it is deliberately the only place
 * that knows about both. `src/model/Work.ts` reads the file and knows nothing of transformers;
 * the transformers know nothing of the file. What is here is the registry lookup that joins
 * them, plus the one substitution a run always makes.
 *
 * It is kept out of the work file's own module: folding the two together would make reading a
 * reconstruction and building a chain one operation, so nothing could open a file it could not
 * also run, and the schema would have to import the registry to state its own types.
 */
import { compareTransformers, validate } from './transformers/Order';
import { createTransformer } from './transformers/TransformerRegistry';
import { InsertMetadata } from './transformers/metadata/InsertMetadata';
import type { Transformer, TransformationOptions } from './transformers/Transformer';
import type { Call } from '../model/Work';

export interface BuiltChain {
    /** The chain as it will run: metadata substituted, in reduction order. */
    transformers: Transformer[];
    /**
     * The calls naming a transformer this build does not have, by `Call.id`.
     *
     * Reported rather than thrown. A reconstruction saved by a newer build — or one saved
     * before a transformer was retired — names things this one cannot run, and the useful
     * answer is the partial chain plus a list of what was dropped. Nothing is dropped silently.
     */
    unknown: Call[];
    title: string;
    author: string;
}

/**
 * Build the chain a work file's provenance describes.
 *
 * The metadata call is rebuilt rather than reused: an MPM needs a `<metadata>` whether or not
 * the chain says so, so the imported one is dropped and a fresh one made from the title and
 * author it carried. That way a document and a reconstruction state their metadata through one
 * code path, and the call belongs to no segment — it writes `<metadata>`, not an instruction.
 */
export function buildChain(provenance: readonly Call[]): BuiltChain {
    const transformers: Transformer[] = [];
    const unknown: Call[] = [];

    for (const call of provenance) {
        const transformer = createTransformer(call.name);
        if (!transformer) {
            unknown.push(call);
            continue;
        }
        transformer.id = call.id;
        transformer.options = call.options as TransformationOptions;
        transformers.push(transformer);
    }

    const metadata = transformers.find((t): t is InsertMetadata => t.name === 'InsertMetadata');
    const title = metadata?.options.comments?.[0]?.text ?? '';
    const author = metadata?.options.authors?.[0]?.text ?? '';

    const chain = [
        new InsertMetadata({
            authors: author ? [{ number: 0, text: author }] : [],
            comments: title ? [{ text: title }] : [],
        }),
        ...transformers.filter((t) => t.name !== 'InsertMetadata'),
    ].sort(compareTransformers);

    return { transformers: chain, unknown, title, author };
}

/**
 * Everything wrong with a chain that can be known without a document: a name this build does
 * not have, and a call whose `requires` nothing before it satisfies.
 */
export const validateChain = (chain: readonly Transformer[]) => validate([...chain]);
