import type { Alignment } from '../fitting/alignment';
import type { Mpm } from '../fitting/instructions/index';
import type { Residual } from '../fitting/residual';
import type { Scope } from '../fitting/instructions/index';
import type { Transformer } from '../fitting/transformers/Transformer';
import type { TempoSecondaryData } from './tempo/TempoDesk';

/**
 * What every desk is handed: the score with the recording laid on it, the performance as it
 * stands, a way to add a call, and what the performance does not yet explain.
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
 */
export interface SecondaryData {
    tempo?: TempoSecondaryData;
}

export interface ViewProps {
    /** The score with the recording laid on it, as the chain left it. */
    msm: Alignment;
    setMSM: (next: Alignment) => void;

    /** The performance as the chain has written it so far. */
    mpm: Mpm;
    setMPM: (next: Mpm) => void;

    /**
     * What the MPM does not yet explain, with this desk's own dimension held out.
     *
     * Derived once per fit and shared, because deriving one renders the whole document: deriving
     * it per desk instead costs a refit eleven seconds.
     */
    residual: Residual;

    /** Where a desk portals its own tools, so they appear in the shared app bar. */
    appBarRef: React.RefObject<HTMLDivElement | null> | null;

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
