import { TransformerViewProps } from "./TransformerViewProps"
import { ArpeggiationDesk } from "./arpeggiation/ArpeggiationDesk";
import { NotesProvider } from "./hooks/NotesProvider";
import { ResultDesk } from "./result/ResultDesk";
import { TempoDesk } from "./tempo/TempoDesk";

export const aspects = ['arpeggiation', 'tempo', 'dynamics', 'result'] as const;
export type Aspect = (typeof aspects)[number];

interface DeskSwitchProps extends TransformerViewProps {
    selectedAspect: Aspect
}

export const DeskSwitch = ({ selectedAspect, msm, mpm, setMSM, setMPM }: DeskSwitchProps) => {
    if (!msm || !mpm || !selectedAspect) {
        return 'not yet ready'
    }

    const props = {
        msm,
        mpm,
        setMSM,
        setMPM
    }

    let desk = <ResultDesk {...props} />

    if (selectedAspect === 'arpeggiation') desk = <ArpeggiationDesk {...props} />
    else if (selectedAspect === 'tempo') desk = <TempoDesk {...props} />

    return (
        <NotesProvider notes={msm.allNotes}>
            {desk}
        </NotesProvider>
    )
}
