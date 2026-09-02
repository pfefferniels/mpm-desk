import type { Alignment } from '../fitting/alignment';
import type { Mpm } from '../fitting/instructions/index';
import type { Residual } from '../fitting/residual';
import type { Scope } from '../fitting/instructions/index';
import type { Transformer } from '../fitting/transformers/Transformer';
import type { Segment as Gestures } from '../model/Reconstruction';
import type { TempoSecondaryData } from './tempo/secondary';

/**
 * What every desk is handed: **what the fit produced**, and nothing else.
 *
 * That is the whole rule for what belongs here. The document a desk edits reaches it through
 * `useWorkDocument`, what is selected through `useCallSelection`, and where its controls go
 * through `DeskToolbar` — three contexts, so that a desk needing more than the common bag does
 * not widen the bag for the other twelve. Two of them used to, and the registry that was supposed
 * to dispatch every desk had to be bypassed for both.
 *
 * **The remainder is not carried on the notes; it is derived.** A desk asks for it with its own
 * dimension held out:
 *
 * ```ts
 * residual.of(note)?.velocity
 * residual.of(note)?.tickDate
 * residual.of(note)?.tickDuration
 * ```
 *
 * A remainder accumulated on the notes — each transformer subtracting its share as it ran — could
 * be neither undone (undoing step 4 leaves steps 5 to 8's subtractions behind) nor refitted, so it
 * is computed on demand instead. The values are `undefined` where the MPM cannot place the note at
 * all — no `<tempo>` covers it — which keeps that case apart from a genuine zero.
 *
 * **Reading instructions is a function, not a method.** `getInstructions(mpm, 'tempo')` is typed
 * by the name, so a wrong record type stops compiling.
 *
 * **There is no `setMSM` or `setMPM`.** There were, and they were passed as functions that did
 * nothing, with a comment saying so: both documents are outputs of the fit and the next run
 * overwrites anything written to them. A no-op in the props is an invitation to call it, so the
 * invitation is withdrawn — a desk edits by adding a call, which is what `addTransformer` is.
 */
export interface SecondaryData {
    tempo?: TempoSecondaryData;
}

export interface ViewProps {
    /** The score with the recording laid on it, as the chain left it. */
    msm: Alignment;

    /** The performance as the chain has written it so far. */
    mpm: Mpm;

    /**
     * What the MPM does not yet explain, with this desk's own dimension held out.
     *
     * Derived once per fit and shared, because deriving one renders the whole document: deriving
     * it per desk instead costs a refit eleven seconds.
     *
     * Null while the alignment's readings still stand side by side. A score note then has a row per
     * take under the one id and there is nothing single to measure, so `deriveResidual` refuses the
     * question rather than answering it off whichever row it kept. The desks that read a residual
     * are the desks `needsChoice` holds shut until a base text has been chosen — see
     * `DeskSwitch.tsx` — so each of them narrows this once and none of them ever draws without one.
     */
    residual: Residual | null;

    /**
     * The claims as the last run projected them — one entry per claim that still has a gesture in
     * the document, keyed by the same id.
     *
     * A fit output like the three above, and here for the same reason they are: not derivable
     * from `mpm` alone, because a span's reach is reported by the call that wrote it rather than
     * written on the instruction.
     */
    projected: readonly Gestures[];

    /** The finished performance as XML, for the drawings that sample the document directly. */
    performanceXml: string;

    /** Desk state that is editorial input and not derivable from the chain. */
    secondary: SecondaryData;
    setSecondary: React.Dispatch<React.SetStateAction<SecondaryData>>;
}

interface TransformerViewProps<T extends Transformer> extends ViewProps {
    addTransformer: (transformer: T, override?: boolean) => void;
}

export type { Scope };

export interface ScopedTransformerViewProps<T extends Transformer>
    extends TransformerViewProps<T> {
    part: Scope;
}
