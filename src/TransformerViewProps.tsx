import { MPM, MSM } from "mpmify";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { TempoSecondaryData } from "./tempo/TempoDesk";

export interface SecondaryData {
    tempo?: TempoSecondaryData;
}

export interface ViewProps {
    setMSM: (newMSM: MSM) => void;
    msm: MSM;

    setMPM: (newMPM: MPM) => void;
    mpm: MPM;

    appBarRef: React.RefObject<HTMLDivElement | null> | null;

    secondary: SecondaryData;
    setSecondary: React.Dispatch<React.SetStateAction<SecondaryData>>;
}

interface TransformerViewProps<T extends Transformer> extends ViewProps {
    addTransformer: (transformer: T, override?: boolean) => void;
}

export type Scope = number | 'global'

export interface ScopedTransformerViewProps<T extends Transformer> extends TransformerViewProps<T> {
    part: Scope
}
