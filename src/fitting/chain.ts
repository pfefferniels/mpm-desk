/**
 * Turning a saved chain back into one that runs.
 *
 * This is the seam between the document and the pipeline, and it is deliberately the only place
 * that knows about both. `src/model/Work.ts` reads the file and knows nothing of transformers;
 * the transformers know nothing of the file. What is here is the registry lookup that joins
 * them, plus the two substitutions a run always makes.
 *
 * It is kept out of the work file's own module: folding the two together would make reading a
 * reconstruction and building a chain one operation, so nothing could open a file it could not
 * also run, and the schema would have to import the registry to state its own types.
 */
import { compareTransformers, validate } from './transformers/Order';
import { canonicalName, createTransformer } from './transformers/TransformerRegistry';
import { InsertMetadata } from './transformers/metadata/InsertMetadata';
import { TranslatePhysicalTimeToTicks } from './transformers/tempo/TranslatePhysicalTimeToTicks';
import type { Transformer, TransformationOptions } from './transformers/Transformer';
import type { Call } from '../model/Work';

/**
 * The one call a run makes for itself rather than because a file asked for it.
 *
 * `TranslatePhysicalTimeToTicks` was a button on the tempo desk, and it should never have been a
 * decision. Everything about it has exactly one answer:
 *
 * - **Where** was never the user's to pick. {@link compareTransformers} sorts the whole chain by
 *   registry order, so adding it on any desk landed it at the hinge in `Order.ts` regardless.
 * - **With what** has one shape. Its only meaningful option is `translatePhysicalModifiers`, and
 *   the desk built it `true` every time; `translatePedalling` is unimplemented. It takes no
 *   scope — it walks `scopesOf` itself — so there is one per chain and never one per part.
 * - **Whether** cannot be answered "no" without breaking the document. Four transformers name it
 *   in `requires`, so a chain that forgot it does not fit worse, it does not fit at all:
 *   `validate` reports and `runFit` throws. It was a mandatory step, on a desk the user might
 *   not be on, that killed the whole reconstruction when missed.
 *
 * So it is injected here, the way {@link InsertMetadata} is, and a file listing one is listing a
 * ghost — `src/model/loadWork.ts` drops it on open for that reason.
 *
 * Injected unconditionally rather than when something needs it. A condition would be a second
 * copy of a rule `Order.ts` already states and free to drift from it, and "only when a later
 * call requires it" is the wrong rule anyway: a chain holding nothing but `InsertTemporalSpread`
 * still wants ticks, because `StylizeOrnamentation` groups ornaments into shared
 * `<ornamentDef>`s by frame value and millisecond frames — all distinct — fragment the defs that
 * tick frames coalesce. Running it when there is nothing to translate costs one pass over the
 * ornaments, which the transformer takes care to make the whole cost.
 */
const INJECTED = 'TranslatePhysicalTimeToTicks';

/**
 * Calls the chain does not run, because what they decided is already in the document it runs over.
 *
 * `Align` says which sounding event realises which written note. That decision is written into the
 * MEI — by `applyAlignment`, before the MEI is converted — so by the time there is an `Alignment`
 * to fold over, there is nothing left for a `transform` to do. Registering a transformer whose
 * body is empty would be a worse way of saying that: it would claim a rank in the reduction order
 * it has no use for, and would have to be excluded from `validate`'s reckoning anyway.
 *
 * Named here rather than dropped silently, because the alternative is worse in both directions: an
 * `Align` call this did not know about would be reported as a transformer this build does not
 * have, which is exactly the report that is supposed to mean something.
 */
const APPLIED_TO_THE_SCORE = new Set(['Align']);

/** Whether the chain leaves this call to the document rather than running it. */
export const isDocumentCall = (name: string): boolean => APPLIED_TO_THE_SCORE.has(name);

/**
 * Whether `name` names the call the run makes for itself — under either spelling, since the
 * shipped file carries the misspelled one.
 */
export const isInjectedCall = (name: string): boolean => canonicalName(name) === INJECTED;

interface BuiltChain {
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
 * Build the chain a work file's provenance describes, plus the two calls it does not have to.
 *
 * The metadata call is rebuilt rather than reused: an MPM needs a `<metadata>` whether or not
 * the chain says so, so the imported one is dropped and a fresh one made from the title and
 * author it carried. That way a document and a reconstruction state their metadata through one
 * code path, and the call belongs to no segment — it writes `<metadata>`, not an instruction.
 *
 * {@link INJECTED} is added on the same footing, and a saved one is dropped so that a file
 * written before this change does not run it twice. The second run would do no work — it skips
 * an ornament already in ticks — and would still be wrong: two calls in the chain, one of them
 * credited with everything and the other with nothing.
 *
 * Neither injected call is in `provenance`, so neither reaches the narrative desk (which reads
 * the document) or a saved file (`provenanceOf` enriches only calls the document holds). They
 * exist for the length of a run.
 *
 * The traffic runs the other way for {@link APPLIED_TO_THE_SCORE}: those calls are in the
 * document and not in the chain.
 */
export function buildChain(provenance: readonly Call[]): BuiltChain {
    const transformers: Transformer[] = [];
    const unknown: Call[] = [];

    for (const call of provenance) {
        if (isDocumentCall(call.name)) continue;

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
        new TranslatePhysicalTimeToTicks({ translatePhysicalModifiers: true }),
        ...transformers.filter((t) => t.name !== 'InsertMetadata' && !isInjectedCall(t.name)),
    ].sort(compareTransformers);

    return { transformers: chain, unknown, title, author };
}

/**
 * Everything wrong with a chain that can be known without a document: a name this build does
 * not have, and a call whose `requires` nothing before it satisfies.
 */
export const validateChain = (chain: readonly Transformer[]) => validate([...chain]);
