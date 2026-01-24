import React, {  } from "react";
import { ScopedTransformerViewProps, ViewProps } from "./TransformerViewProps"
import { DynamicsDesk } from "./dynamics/DynamicsDesk";
import { TempoDesk } from "./tempo/TempoDesk";
import { ArticulationDesk } from "./articulation/ArticulationDesk";
import { RubatoDesk } from "./rubato/RubatoDesk";
import { MetadataDesk } from "./metadata/MetadataDesk";
import { PedalDesk } from "./pedal/PedalDesk";
import { AccentuationDesk } from "./accentuation/AccentuationDesk";
import { CombineAdjacentRubatos, InsertDynamicsGradient, InsertDynamicsInstructions, InsertMetricalAccentuation, InsertPedal, InsertRubato, ApproximateLogarithmicTempo, InsertTemporalSpread, StylizeArticulation, StylizeOrnamentation, TranslatePhyiscalTimeToTicks, MergeMetricalAccentuations, InsertArticulation, MakeChoice } from "mpmify";
import { DynamicsGradientDesk } from "./arpeggiation/DynamicsGradientDesk";
import { TemporalSpreadDesk } from "./arpeggiation/TemporalSpreadDesk";
import { ResultDesk } from "./result/ResultDesk";
import { OrnamentationStyles } from "./styles/OrnamentationStyles";
import { ArticulationStyles } from "./styles/ArticulationStyles";
import { ChoiceDesk } from "./choice/ChoiceDesk";

export type AnyTransformer =
    | typeof InsertDynamicsInstructions
    | typeof InsertTemporalSpread
    | typeof InsertDynamicsGradient
    | typeof InsertRubato
    | typeof ApproximateLogarithmicTempo
    | typeof InsertMetricalAccentuation
    | typeof InsertPedal
    | typeof CombineAdjacentRubatos
    | typeof StylizeOrnamentation
    | typeof StylizeArticulation
    | typeof TranslatePhyiscalTimeToTicks
    | typeof MergeMetricalAccentuations
    | typeof InsertArticulation
    | typeof MakeChoice

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDesk = React.FC<ScopedTransformerViewProps<any>> | React.FC<ViewProps>;

export const correspondingDesks: { transformer?: AnyTransformer, aspect: string, desk: AnyDesk, displayName?: string, group?: string }[] = [
    // General
    {
        aspect: 'metadata',
        desk: MetadataDesk,
        group: 'general'
    },
    {
        aspect: 'source choice',
        displayName: 'Base Text',
        desk: ChoiceDesk,
        transformer: MakeChoice,
        group: 'general'
    },
    // Timing
    {
        transformer: ApproximateLogarithmicTempo,
        desk: TempoDesk,
        aspect: 'tempo',
        group: 'timing'
    },
    {
        transformer: InsertRubato,
        desk: RubatoDesk,
        aspect: 'rubato',
        group: 'timing'
    },
    {
        transformer: InsertTemporalSpread,
        desk: TemporalSpreadDesk,
        displayName: 'Temporal Spread',
        aspect: 'arpeggiation',
        group: 'timing'
    },
    {
        transformer: InsertDynamicsGradient,
        desk: DynamicsGradientDesk,
        displayName: 'Dynamics Gradient',
        aspect: 'arpeggiation',
        group: 'timing'
    },
    {
        transformer: StylizeOrnamentation,
        desk: OrnamentationStyles,
        aspect: 'arpeggiation',
        displayName: 'Styles',
        group: 'timing'
    },
    // Dynamics
    {
        transformer: InsertDynamicsInstructions,
        aspect: 'dynamics',
        desk: DynamicsDesk,
        group: 'dynamics'
    },
    {
        transformer: InsertMetricalAccentuation,
        desk: AccentuationDesk,
        displayName: 'Metrical Accentuation',
        aspect: 'accentuation',
        group: 'dynamics'
    },
    {
        transformer: InsertArticulation,
        aspect: 'articulation',
        desk: ArticulationDesk,
        displayName: 'Articulation',
        group: 'dynamics'
    },
    {
        transformer: StylizeArticulation,
        aspect: 'articulation',
        displayName: 'Style',
        desk: ArticulationStyles,
        group: 'dynamics'
    },
    // Pedalling
    {
        transformer: InsertPedal,
        aspect: 'pedalling',
        desk: PedalDesk,
        group: 'pedalling'
    },
    // Result
    {
        aspect: 'result',
        desk: ResultDesk,
        group: 'result'
    }
]

