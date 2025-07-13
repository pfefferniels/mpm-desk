import React, {  } from "react";
import { ScopedTransformerViewProps, ViewProps } from "./TransformerViewProps"
import { DynamicsDesk } from "./dynamics/DynamicsDesk";
import { TempoDesk } from "./tempo/TempoDesk";
import { ArticulationDesk } from "./articulation/ArticulationDesk";
import { RubatoDesk } from "./rubato/RubatoDesk";
import { MetadataDesk } from "./metadata/MetadataDesk";
import { PedalDesk } from "./pedal/PedalDesk";
import { AccentuationDesk } from "./accentuation/AccentuationDesk";
import { CombineAdjacentRubatos, InsertDynamicsGradient, InsertDynamicsInstructions, InsertMetricalAccentuation, InsertPedal, InsertRelativeDuration, InsertRelativeVolume, InsertRubato, ApproximateLogarithmicTempo, InsertTemporalSpread, StylizeArticulation, StylizeOrnamentation, TranslatePhyiscalTimeToTicks, MakeArticulationDefinition, MergeArticulations, MergeMetricalAccentuations, InsertArticulation, MakeChoice } from "mpmify";
import { DynamicsGradientDesk } from "./arpeggiation/DynamicsGradientDesk";
import { TemporalSpreadDesk } from "./arpeggiation/TemporalSpreadDesk";
import { ResultDesk } from "./result/ResultDesk";
import { OrnamentationStyles } from "./styles/OrnamentationStyles";
import { ArticulationStyles } from "./styles/ArticulationStyles";
import { RelativeVolumeDesk } from "./accentuation/RelativeVolumeDesk";
import { ChoiceDesk } from "./choice/ChoiceDesk";

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
    | typeof MakeChoice

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDesk = React.FC<ScopedTransformerViewProps<any>> | React.FC<ViewProps>;

export const correspondingDesks: { transformer?: AnyTransformer, aspect: string, desk: AnyDesk, displayName?: string }[] = [
    {
        transformer: InsertDynamicsInstructions,
        aspect: 'dynamics',
        desk: DynamicsDesk,
    },
    {
        aspect: 'ecclecticism',
        displayName: 'Base Text',
        desk: ChoiceDesk,
        transformer: MakeChoice
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
        displayName: 'Articulation'
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

