import { MPM, MSM } from "mpmify";
import { Transformer } from "mpmify/lib/transformers/Transformer";

export interface TransformerViewProps {
    setMSM: (newMSM: MSM) => void;
    msm: MSM;

    setMPM: (newMPM: MPM) => void;
    mpm: MPM;

    addTransformer: (transformer: Transformer) => void;
}
