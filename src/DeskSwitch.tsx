import { useState } from "react";
import { TransformerViewProps } from "./TransformerViewProps"
import { ArpeggiationDesk } from "./arpeggiation/ArpeggiationDesk";
import { DynamicsDesk } from "./dynamics/DynamicsDesk";
import { NotesProvider } from "./hooks/NotesProvider";
import { ResultDesk } from "./result/ResultDesk";
import { StylesDesk } from "./styles/StylesDesk";
import { TempoDesk } from "./tempo/TempoDesk";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { ArticulationDesk } from "./articulation/ArticulationDesk";
import { RubatoDesk } from "./rubato/RubatoDesk";
import { MetadataDesk } from "./metadata/MetadataDesk";
import { PedalDesk } from "./pedal/PedalDesk";
import { AccentuationDesk } from "./accentuation/AccentuationDesk";

export const aspects = [
    'arpeggiation',
    'tempo',
    'dynamics',
    'rubato',
    'accentuation',
    'articulation',
    'pedalling',
    'styles',
    'result',
    'metadata',
] as const;

export type Aspect = (typeof aspects)[number];

interface DeskSwitchProps extends TransformerViewProps {
    selectedAspect: Aspect
}

export type Scope = number | 'global'

export interface ScopedTransformerViewProps extends TransformerViewProps {
    part: Scope
}

export const DeskSwitch = (props: DeskSwitchProps) => {
    const [scope, setScope] = useState<Scope>('global')

    const { selectedAspect, msm, mpm } = props

    const availableParts = [...msm.parts()]

    if (!msm || !mpm || !selectedAspect) {
        return 'not yet ready'
    }

    let DeskComponent: React.FC<ScopedTransformerViewProps> = ResultDesk
    if (selectedAspect === 'arpeggiation') DeskComponent = ArpeggiationDesk
    else if (selectedAspect === 'tempo') DeskComponent = TempoDesk
    else if (selectedAspect === 'styles') DeskComponent = StylesDesk
    else if (selectedAspect === 'dynamics') DeskComponent = DynamicsDesk
    else if (selectedAspect === 'articulation') DeskComponent = ArticulationDesk
    else if (selectedAspect === 'rubato') DeskComponent = RubatoDesk
    else if (selectedAspect === 'metadata') DeskComponent = MetadataDesk
    else if (selectedAspect === 'pedalling') DeskComponent = PedalDesk
    else if (selectedAspect === 'accentuation') DeskComponent = AccentuationDesk

    return (
        <NotesProvider notes={msm.allNotes}>
            <ToggleButtonGroup
                size='small'
                value={scope}
                exclusive
                onChange={(_, value) => setScope(value)}
                sx={{ pt: 1, pb: 1 }}
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
            <div style={{ overflow: 'scroll', maxHeight: '80vh', width: '80vw' }}>
                <DeskComponent {...props} part={scope} />
            </div>
        </NotesProvider>
    )
}
