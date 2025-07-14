import { MPM, MSM } from "mpmify";
import { Transformer } from "mpmify/lib/transformers/Transformer";

export interface ViewProps {
    setMSM: (newMSM: MSM) => void;
    msm: MSM;

    setMPM: (newMPM: MPM) => void;
    mpm: MPM;

    appBarRef: React.RefObject<HTMLDivElement>;
}

export interface TransformerViewProps<T extends Transformer> extends ViewProps {
    addTransformer: (transformer: T) => void;
    activeElements: string[]
    setActiveElement: (elements: string) => void;
}

export type Scope = number | 'global'

export interface ScopedTransformerViewProps<T extends Transformer> extends TransformerViewProps<T> {
    part: Scope
}
