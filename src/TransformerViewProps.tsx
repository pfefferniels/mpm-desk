import { MPM, MSM } from "mpmify";
import { Transformer } from "mpmify/lib/transformers/Transformer";

export interface ViewProps {
    setMSM: (newMSM: MSM) => void;
    msm: MSM;

    setMPM: (newMPM: MPM) => void;
    mpm: MPM;
}

export interface TransformerViewProps<T extends Transformer> extends ViewProps {
    addTransformer: <U extends T>(transformer: U) => void;
    wasCreatedBy: (id: string) => T | undefined;
    activeTransformer?: T;
    setActiveTransformer: (transformer?: T) => void;
}
