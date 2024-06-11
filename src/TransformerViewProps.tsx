import { MPM, MSM } from "mpmify";

export interface TransformerViewProps {
    setMSM: (newMSM: MSM) => void;
    msm: MSM;

    setMPM: (newMPM: MPM) => void;
    mpm: MPM;
}
