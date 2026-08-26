import React from 'react';
import type { ScopedTransformerViewProps, ViewProps } from './TransformerViewProps';
import type { InstructionType } from '../fitting/instructions/index';
import { DynamicsDesk } from './dynamics/DynamicsDesk';
import { TempoDesk } from './tempo/TempoDesk';
import { ArticulationDesk } from './articulation/ArticulationDesk';
import { RubatoDesk } from './rubato/RubatoDesk';
import { PedalDesk } from './pedal/PedalDesk';
import { AccentuationDesk } from './accentuation/AccentuationDesk';
import { DynamicsGradientDesk } from './arpeggiation/DynamicsGradientDesk';
import { TemporalSpreadDesk } from './arpeggiation/TemporalSpreadDesk';
import { ResultDesk } from './result/ResultDesk';
import { OrnamentationStyles } from './styles/OrnamentationStyles';
import { ChoiceDesk } from './choice/ChoiceDesk';
import { ArticulationStyles } from './styles/ArticulationStyles';
import { SegmentsDesk } from './segments/SegmentsDesk';
import { MakeChoice } from '../fitting/transformers/choice/MakeChoice';
import { InsertRubato } from '../fitting/transformers/rubato/InsertRubato';
import { CombineAdjacentRubatos } from '../fitting/transformers/rubato/CombineAdjacentRubatos';
import { InsertPedal } from '../fitting/transformers/pedal/InsertPedalInstructions';
import { InsertArticulation } from '../fitting/transformers/articulation/InsertArticulation';
import { StylizeArticulation } from '../fitting/transformers/articulation/StylizeArticulation';
import { InsertDynamicsInstructions } from '../fitting/transformers/dynamics/InsertDynamicsInstructions';
import {
    InsertMetricalAccentuation,
    MergeMetricalAccentuations,
} from '../fitting/transformers/accentuation/index';
import {
    InsertDynamicsGradient,
    InsertTemporalSpread,
    StylizeOrnamentation,
} from '../fitting/transformers/ornamentation/index';
import {
    InsertTempo,
    TranslatePhysicalTimeToTicks,
} from '../fitting/transformers/tempo/index';

type AnyTransformer =
    | typeof InsertDynamicsInstructions
    | typeof InsertTemporalSpread
    | typeof InsertDynamicsGradient
    | typeof InsertRubato
    | typeof CombineAdjacentRubatos
    | typeof StylizeArticulation
    | typeof InsertMetricalAccentuation
    | typeof InsertPedal
    | typeof StylizeOrnamentation
    | typeof TranslatePhysicalTimeToTicks
    | typeof MergeMetricalAccentuations
    | typeof InsertArticulation
    | typeof MakeChoice
    | typeof InsertTempo;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDesk = React.FC<ScopedTransformerViewProps<any>> | React.FC<ViewProps>;

export interface DeskEntry {
    transformer?: AnyTransformer;
    aspect: string;
    desk: AnyDesk;
    displayName?: string;
    group?: string;
    /**
     * The instruction types this desk's `residual` must be derived **without**.
     *
     * The one piece of desk configuration that is a correctness requirement rather than a
     * presentation choice, so it is declared here rather than left to each desk to remember.
     *
     * A desk that plots a residual is plotting *what its own dimension still has to account
     * for*, which is only that quantity if its own dimension is held out of the probe. Get it
     * wrong and the failure is quiet and self-concealing: the accentuation desk's dots collapse
     * toward zero the moment a pattern is inserted, because it would be drawing what is left
     * over **after** the very thing it is fitting — so the beat you drew a cell around is the
     * one that disappears, and the desk looks like it is working.
     *
     * The transformer's own `deriveResidual` call is the authority; these match it. `InsertRubato`
     * holds out `rubato`, `InsertArticulation` `articulation`, `InsertPedal` `movement`,
     * `InsertMetricalAccentuation` `accentuationPattern`.
     *
     * Empty where a desk plots the recording raw — the dynamics desk draws recorded velocity, the
     * arpeggiation desks read recorded onsets, and none of them wants anything subtracted.
     */
    holdOut?: readonly InstructionType[];
}

/**
 * Which desk edits which aspect of the performance.
 *
 * Grouping calls and saying what a group claims is a step of its own, so it has a desk of its own
 * here beside the desks that edit a single dimension.
 *
 * Three transformers appear in no call of the reconstruction and are kept all the same, because
 * these desks put controls on them: the rubato Combine button, the ornamentation Style desk, and
 * `MakeDefaultArticulation`. `Order.ts` records that reasoning.
 */
export const correspondingDesks: DeskEntry[] = [
    // General
    {
        aspect: 'source choice',
        displayName: 'Base Text',
        desk: ChoiceDesk,
        transformer: MakeChoice,
        group: 'general',
    },
    // Timing
    {
        transformer: InsertTempo,
        desk: TempoDesk,
        aspect: 'tempo',
        group: 'timing',
    },
    {
        transformer: InsertRubato,
        desk: RubatoDesk,
        aspect: 'rubato',
        group: 'timing',
        holdOut: ['rubato'],
    },
    {
        transformer: InsertTemporalSpread,
        desk: TemporalSpreadDesk,
        displayName: 'Temporal Spread',
        aspect: 'arpeggiation',
        group: 'timing',
    },
    {
        transformer: InsertDynamicsGradient,
        desk: DynamicsGradientDesk,
        displayName: 'Dynamics Gradient',
        aspect: 'arpeggiation',
        group: 'timing',
    },
    {
        transformer: StylizeOrnamentation,
        desk: OrnamentationStyles,
        aspect: 'arpeggiation',
        displayName: 'Styles',
        group: 'timing',
    },
    // Dynamics
    {
        transformer: InsertDynamicsInstructions,
        aspect: 'dynamics',
        desk: DynamicsDesk,
        group: 'dynamics',
    },
    {
        transformer: InsertMetricalAccentuation,
        desk: AccentuationDesk,
        displayName: 'Metrical Accentuation',
        aspect: 'accentuation',
        group: 'dynamics',
        holdOut: ['accentuationPattern'],
    },
    {
        transformer: InsertArticulation,
        aspect: 'articulation',
        desk: ArticulationDesk,
        displayName: 'Articulation',
        group: 'dynamics',
        holdOut: ['articulation'],
    },
    {
        transformer: StylizeArticulation,
        aspect: 'articulation',
        displayName: 'Style',
        desk: ArticulationStyles,
        group: 'dynamics',
    },
    // Pedalling
    {
        transformer: InsertPedal,
        aspect: 'pedalling',
        desk: PedalDesk,
        group: 'pedalling',
        // A recorded pedal has no symbolic date of its own; the residual is the only thing that
        // can put one on the tick grid at all.
        holdOut: ['movement'],
    },
    // The argument
    {
        aspect: 'segments',
        displayName: 'Segments',
        desk: SegmentsDesk as AnyDesk,
        group: 'argument',
    },
    // Result
    {
        aspect: 'result',
        desk: ResultDesk,
        group: 'result',
    },
];
