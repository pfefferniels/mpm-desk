import { MPM, MSM } from "mpmify";
import { Transformer } from "mpmify/lib/transformers/Transformer";

export interface ViewProps {
    setMSM: (newMSM: MSM) => void;
    msm: MSM;

    setMPM: (newMPM: MPM) => void;
    mpm: MPM;

    appBarRef: React.RefObject<HTMLDivElement> | null;

    secondary: Record<string, unknown>;
    setSecondary: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}

export interface TransformerViewProps<T extends Transformer> extends ViewProps {
    addTransformer: (transformer: T, override?: boolean) => void;
}

export type Scope = number | 'global'

export interface ScopedTransformerViewProps<T extends Transformer> extends TransformerViewProps<T> {
    part: Scope
}
