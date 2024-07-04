import { useState } from "react";
import { TransformerViewProps } from "./TransformerViewProps"
import { ArpeggiationDesk } from "./arpeggiation/ArpeggiationDesk";
import { DynamicsDesk } from "./dynamics/DynamicsDesk";
import { NotesProvider } from "./hooks/NotesProvider";
import { ResultDesk } from "./result/ResultDesk";
import { StylesDesk } from "./styles/StylesDesk";
import { TempoDesk } from "./tempo/TempoDesk";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";

export const aspects = ['arpeggiation', 'tempo', 'dynamics', 'styles', 'result'] as const;
export type Aspect = (typeof aspects)[number];

interface DeskSwitchProps extends TransformerViewProps {
    selectedAspect: Aspect
}

export type Scope = number | 'global'

export interface ScopedTransformerViewProps extends TransformerViewProps {
    part: Scope
}

export const DeskSwitch = ({ selectedAspect, msm, mpm, setMSM, setMPM }: DeskSwitchProps) => {
    const [scope, setScope] = useState<Scope>('global')

    const availableParts = [...msm.parts()]

    if (!msm || !mpm || !selectedAspect) {
        return 'not yet ready'
    }

    const props: TransformerViewProps = {
        msm,
        mpm,
        setMSM,
        setMPM
    }

    let DeskComponent: React.FC<ScopedTransformerViewProps> = ResultDesk
    if (selectedAspect === 'arpeggiation') DeskComponent = ArpeggiationDesk
    else if (selectedAspect === 'tempo') DeskComponent = TempoDesk
    else if (selectedAspect === 'styles') DeskComponent = StylesDesk
    else if (selectedAspect === 'dynamics') DeskComponent = DynamicsDesk

    return (
        <NotesProvider notes={msm.allNotes}>
            <ToggleButtonGroup
                size='small'
                value={scope}
                exclusive
                onChange={(_, value) => setScope(value)}
            >
                <ToggleButton value='global'>
                    Global
                </ToggleButton>
                {availableParts.map(p => (
                    <ToggleButton key={`button_${p}`} value={p}>
                        {p}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
            <div style={{ overflow: 'scroll', maxHeight: '70vh', width: '80vw' }}>
                <DeskComponent {...props} part={scope} />
            </div>
        </NotesProvider>
    )
}
