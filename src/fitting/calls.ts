/**
 * A saved call, read as the transformer it names.
 *
 * `Call.options` is `Record<string, unknown>` because `src/model/Work.ts` knows nothing of
 * transformers. A reader that does know which transformer it wants narrows by name here, and gets
 * that transformer's options typed, rather than casting at the call site.
 *
 * The narrowing trusts the name, exactly as `buildChain` does when it hands the same options to
 * the transformer the registry builds for it. What it adds is that the trust is taken in one place,
 * and that a name the registry does not hold, or options read as the wrong transformer's, is a
 * type error. A reader that has to survive a malformed file reads structurally instead, as
 * `workReducer.ts` does.
 */
import type { Call } from '../model/Work';
import type { RegisteredTransformer } from './transformers/Order';

/** The name a registered transformer is saved under: its current one, never an alias. */
type TransformerName = RegisteredTransformer['name'];

/** The options the transformer saved as `N` takes. */
type OptionsOf<N extends TransformerName> = Extract<
    RegisteredTransformer,
    { name: N }
>['options'];

/** A call naming `N`, with that transformer's options. */
type CallOf<N extends TransformerName> = Call & { name: N; options: OptionsOf<N> };

/** A predicate, for `filter` and `find`, picking out the calls that name `name`. */
export const isCallOf =
    <N extends TransformerName>(name: N) =>
    (call: Call): call is CallOf<N> =>
        call.name === name;
