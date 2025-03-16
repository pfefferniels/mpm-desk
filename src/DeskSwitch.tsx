import React, { useEffect, useState } from "react";
import { TransformerViewProps, ViewProps } from "./TransformerViewProps"
import { DynamicsDesk } from "./dynamics/DynamicsDesk";
import { NotesProvider } from "./hooks/NotesProvider";
import { TempoDesk } from "./tempo/TempoDesk";
import { Tab, Tabs, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { ArticulationDesk } from "./articulation/ArticulationDesk";
import { RubatoDesk } from "./rubato/RubatoDesk";
import { MetadataDesk } from "./metadata/MetadataDesk";
import { PedalDesk } from "./pedal/PedalDesk";
import { AccentuationDesk } from "./accentuation/AccentuationDesk";
import { CombineAdjacentRubatos, InsertDynamicsGradient, InsertDynamicsInstructions, InsertMetricalAccentuation, InsertPedal, InsertRelativeDuration, InsertRelativeVolume, InsertRubato, ApproximateLogarithmicTempo, InsertTemporalSpread, StylizeArticulation, StylizeOrnamentation, TranslatePhyiscalTimeToTicks, MakeArticulationDefinition, MergeArticulations, MergeMetricalAccentuations, InsertArticulation } from "mpmify";
import { ScopedTransformationOptions, Transformer } from "mpmify/lib/transformers/Transformer";
import { TabPanel } from "./TabPanel";
import { DynamicsGradientDesk } from "./arpeggiation/DynamicsGradientDesk";
import { TemporalSpreadDesk } from "./arpeggiation/TemporalSpreadDesk";
import { ResultDesk } from "./result/ResultDesk";
import { OrnamentationStyles } from "./styles/OrnamentationStyles";
import { ArticulationStyles } from "./styles/ArticulationStyles";
import { RelativeVolumeDesk } from "./accentuation/RelativeVolumeDesk";

export const aspects = [
    'metadata',
    'arpeggiation',
    'tempo',
    'dynamics',
    'rubato',
    'accentuation',
    'articulation',
    'pedalling',
    'result',
] as const;

export type Aspect = (typeof aspects)[number];

export type AnyTransformer =
    | typeof InsertDynamicsInstructions
    | typeof InsertTemporalSpread
    | typeof InsertDynamicsGradient
    | typeof InsertRubato
    | typeof ApproximateLogarithmicTempo
    | typeof InsertMetricalAccentuation
    | typeof InsertRelativeDuration
    | typeof InsertRelativeVolume
    | typeof InsertPedal
    | typeof CombineAdjacentRubatos
    | typeof StylizeOrnamentation
    | typeof StylizeArticulation
    | typeof TranslatePhyiscalTimeToTicks
    | typeof MakeArticulationDefinition
    | typeof MergeArticulations
    | typeof MergeMetricalAccentuations
    | typeof InsertArticulation

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDesk = React.FC<ScopedTransformerViewProps<any>> | React.FC<ViewProps>;

const correspondingDesks: { transformer?: AnyTransformer, aspect: Aspect, desk: AnyDesk, displayName?: string }[] = [
    {
        transformer: InsertDynamicsInstructions,
        aspect: 'dynamics',
        desk: DynamicsDesk,
    },
    {
        transformer: InsertDynamicsGradient,
        desk: DynamicsGradientDesk,
        displayName: 'Dynamics Gradient',
        aspect: 'arpeggiation'
    },
    {
        transformer: InsertTemporalSpread,
        desk: TemporalSpreadDesk,
        displayName: 'Temporal Spread',
        aspect: 'arpeggiation'
    },
    {
        transformer: StylizeOrnamentation,
        desk: OrnamentationStyles,
        aspect: 'arpeggiation',
        displayName: 'Styles'
    },
    {
        transformer: InsertRubato,
        desk: RubatoDesk,
        aspect: 'rubato'
    },
    {
        transformer: ApproximateLogarithmicTempo,
        desk: TempoDesk,
        aspect: 'tempo'
    },
    {
        transformer: InsertMetricalAccentuation,
        desk: AccentuationDesk,
        displayName: 'Metrical Accentuation',
        aspect: 'accentuation'
    },
    {
        transformer: InsertRelativeVolume,
        aspect: 'accentuation',
        displayName: 'Relative Volume',
        desk: RelativeVolumeDesk
    },
    {
        transformer: InsertArticulation,
        aspect: 'articulation',
        desk: ArticulationDesk,
    },
    {
        transformer: StylizeArticulation,
        aspect: 'articulation',
        displayName: 'Style',
        desk: ArticulationStyles
    },
    {
        transformer: InsertPedal,
        aspect: 'pedalling',
        desk: PedalDesk,
    },
    {
        aspect: 'metadata',
        desk: MetadataDesk
    },
    {
        aspect: 'result',
        desk: ResultDesk
    }
]

interface DeskSwitchProps extends TransformerViewProps<Transformer> {
    aspect: Aspect
    changeAspect: (aspect: Aspect) => void
}

export type Scope = number | 'global'

export interface ScopedTransformerViewProps<T extends Transformer> extends TransformerViewProps<T> {
    part: Scope
}

export const DeskSwitch = (props: DeskSwitchProps) => {
    const [scope, setScope] = useState<Scope>('global')
    const [tabIndex, setTabIndex] = useState(0)

    const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
        props.setActiveTransformer(undefined)
        setTabIndex(newValue)
    }

    const { aspect, changeAspect, activeTransformer, setActiveTransformer, msm, mpm } = props

    useEffect(() => {
        if (!activeTransformer) return
        const entry = correspondingDesks
            .filter(entry => !!entry.transformer)
            .find(({ transformer }) => transformer!.name === activeTransformer.name)

        if (entry) {
            changeAspect(entry.aspect)
            setTabIndex(correspondingDesks
                .filter(({ aspect }) => aspect === entry.aspect)
                .findIndex(({ transformer }) => transformer!.name === activeTransformer.name))

            if ('scope' in activeTransformer.options) {
                setScope((activeTransformer.options as ScopedTransformationOptions).scope)
            }
        }
    }, [activeTransformer, changeAspect])

    const availableParts = [...msm.parts()]

    if (!msm || !mpm || !aspect) {
        return 'not yet ready'
    }

    let DeskComponents: AnyDesk[] = [MetadataDesk]
    DeskComponents = correspondingDesks
        .filter(entry => entry.aspect === aspect)
        .map(({ desk }) => desk)

    if (DeskComponents.length <= tabIndex) {
        setTabIndex(0)
    }

    if (correspondingDesks.find(entry => entry.desk === DeskComponents[tabIndex])?.transformer?.name
        !== activeTransformer?.name) {
        console.log('resetting active transformer', activeTransformer?.name)
        setActiveTransformer(undefined)
    }

    return (
        <NotesProvider notes={msm.allNotes}>
            {DeskComponents.length > 1 && (
                <>
                    <Tabs value={tabIndex} onChange={handleTabChange} aria-label="Subdesks">
                        {DeskComponents.map((DeskComponent, index) => {
                            const displayName = correspondingDesks.find(entry => entry.desk === DeskComponent)?.displayName
                            return (
                                <Tab
                                    label={displayName || DeskComponent.name}
                                    id={`simple-tab-${index}`}
                                    aria-controls={`simple-tab-${index}`}
                                />
                            )
                        })}
                    </Tabs>
                </>
            )}

            {DeskComponents.map((DeskComponent, i) => {
                return (
                    <TabPanel key={`tabPanel_${i}`} value={tabIndex} index={i}>
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
                    </TabPanel>)
            })}

        </NotesProvider>
    )
}
