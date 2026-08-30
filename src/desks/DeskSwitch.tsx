import { lazy, type ComponentType } from 'react';
import type { ScopedTransformerViewProps } from './TransformerViewProps';
import type { Transformer } from '../fitting/transformers/Transformer';
import type { InstructionType } from '../fitting/instructions/index';

/**
 * What a desk is, as far as the registry is concerned.
 *
 * Every desk is handed the same bag, so the registry can hold them all at one type. It used to
 * be `React.FC<ScopedTransformerViewProps<any>>` behind an eslint-disable; it does not need to
 * be. A desk written against its own transformer — `ScopedTransformerViewProps<InsertTempo>` —
 * is assignable here because props are checked contravariantly: a desk whose `addTransformer`
 * accepts only an `InsertTempo` can be handed one that accepts any `Transformer`, which is what
 * the editor passes. A desk that takes plain `ViewProps` fits for the ordinary reason that it
 * asks for less than it is given.
 */
type DeskComponent = ComponentType<ScopedTransformerViewProps<Transformer>>;

interface DeskEntry {
    /**
     * The transformer whose calls this desk makes, **by name**.
     *
     * A name rather than the class, because the only thing anything ever read off the class was
     * `.name` — the editor uses it to find the desk that made a saved call. Importing fourteen
     * transformer classes to read fourteen strings pulled the whole fitting chain into the
     * registry's chunk, and the registry is imported by the aspect menu, which is on screen
     * before any desk is open.
     *
     * Nothing checks these against the transformers at compile time and a type could not do it
     * honestly — the list would have to be hand-maintained beside this one and would drift the
     * same way. `DeskSwitch.test.ts` resolves every name against the real transformer registry
     * instead, which catches a typo, a rename and a removal alike.
     */
    transformerName?: string;
    aspect: string;
    desk: DeskComponent;
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
 *
 * ## A desk arrives when it is opened
 *
 * Every desk was imported here, so opening the editor downloaded all thirteen of them and the
 * transformers behind them before drawing the first one. They are `lazy` now: this module holds
 * what the aspect menu needs to list a desk — its aspect, its group, the name it shows — and the
 * desk itself arrives when somebody asks for it. The menu is built from this list, so it must
 * stay readable without loading anything.
 */
export const correspondingDesks: DeskEntry[] = [
    // The document itself. A group of its own so the menu still sets it apart, which it used to
    // do by being written into the menu by hand rather than being in this list at all.
    {
        aspect: 'metadata',
        desk: lazy(() =>
            import('./metadata/MetadataDesk').then((m) => ({ default: m.MetadataDeskEntry })),
        ),
        group: 'document',
    },
    // Beside metadata, in the document's own group: which MEI voice goes into which MSM part is a
    // statement about the score's encoding rather than about a dimension of the sound, and it is
    // upstream of everything — it decides what the scope picker offers every other desk.
    {
        transformerName: 'ProcessVoices',
        aspect: 'voices',
        desk: lazy(() => import('./voices/VoicesDesk').then((m) => ({ default: m.VoicesDesk }))),
        group: 'document',
        // No hold-out: `holdOut` is for a desk that plots a residual, and this one never asks for
        // one. It draws the score verovio engraves and colours it by the part the chain resolved,
        // and there is nothing for the MPM to explain away when the subject is which staff a note
        // is written on.
    },
    // General
    {
        aspect: 'source choice',
        displayName: 'Base Text',
        desk: lazy(() => import('./choice/ChoiceDesk').then((m) => ({ default: m.ChoiceDesk }))),
        transformerName: 'MakeChoice',
        group: 'general',
    },
    // Beside Base Text, and not by accident: these two are the desks that edit the *recording*
    // rather than the performance, which is the one distinction the menu's groups can make that
    // the aspect names cannot.
    //
    // Its place in this list is load-bearing beyond the ordering the user sees. `AspectSelect`
    // draws a divider wherever `group` changes from one entry to the next, walking the array —
    // so an entry of an existing group written anywhere but beside its group splits that group in
    // two on screen.
    {
        transformerName: 'Modify',
        aspect: 'corrections',
        desk: lazy(() =>
            import('./corrections/CorrectionsDesk').then((m) => ({ default: m.CorrectionsDesk })),
        ),
        group: 'general',
        // No hold-out: like the dynamics desk, this one plots the recording raw. There is nothing
        // for the MPM to explain away when the subject is what the roll scan read.
    },
    // Timing
    {
        transformerName: 'InsertTempo',
        desk: lazy(() => import('./tempo/TempoDesk').then((m) => ({ default: m.TempoDesk }))),
        aspect: 'tempo',
        group: 'timing',
    },
    {
        transformerName: 'InsertRubato',
        desk: lazy(() => import('./rubato/RubatoDesk').then((m) => ({ default: m.RubatoDesk }))),
        aspect: 'rubato',
        group: 'timing',
        holdOut: ['rubato'],
    },
    {
        transformerName: 'InsertTemporalSpread',
        desk: lazy(() =>
            import('./arpeggiation/TemporalSpreadDesk').then((m) => ({
                default: m.TemporalSpreadDesk,
            })),
        ),
        displayName: 'Temporal Spread',
        aspect: 'arpeggiation',
        group: 'timing',
    },
    {
        transformerName: 'InsertDynamicsGradient',
        desk: lazy(() =>
            import('./arpeggiation/DynamicsGradientDesk').then((m) => ({
                default: m.DynamicsGradientDesk,
            })),
        ),
        displayName: 'Dynamics Gradient',
        aspect: 'arpeggiation',
        group: 'timing',
    },
    {
        transformerName: 'StylizeOrnamentation',
        desk: lazy(() =>
            import('./styles/OrnamentationStyles').then((m) => ({
                default: m.OrnamentationStyles,
            })),
        ),
        aspect: 'arpeggiation',
        displayName: 'Styles',
        group: 'timing',
    },
    // Dynamics
    {
        transformerName: 'InsertDynamicsInstructions',
        aspect: 'dynamics',
        desk: lazy(() =>
            import('./dynamics/DynamicsDesk').then((m) => ({ default: m.DynamicsDesk })),
        ),
        group: 'dynamics',
    },
    {
        transformerName: 'InsertMetricalAccentuation',
        desk: lazy(() =>
            import('./accentuation/AccentuationDesk').then((m) => ({
                default: m.AccentuationDesk,
            })),
        ),
        displayName: 'Metrical Accentuation',
        aspect: 'accentuation',
        group: 'dynamics',
        holdOut: ['accentuationPattern'],
    },
    {
        transformerName: 'InsertArticulation',
        aspect: 'articulation',
        desk: lazy(() =>
            import('./articulation/ArticulationDesk').then((m) => ({
                default: m.ArticulationDesk,
            })),
        ),
        displayName: 'Articulation',
        group: 'dynamics',
        holdOut: ['articulation'],
    },
    {
        transformerName: 'StylizeArticulation',
        aspect: 'articulation',
        displayName: 'Style',
        desk: lazy(() =>
            import('./styles/ArticulationStyles').then((m) => ({ default: m.ArticulationStyles })),
        ),
        group: 'dynamics',
    },
    // Pedalling
    {
        transformerName: 'InsertPedal',
        aspect: 'pedalling',
        desk: lazy(() => import('./pedal/PedalDesk').then((m) => ({ default: m.PedalDesk }))),
        group: 'pedalling',
        // A recorded pedal has no symbolic date of its own; the residual is the only thing that
        // can put one on the tick grid at all.
        holdOut: ['movement'],
    },
    // The argument
    {
        aspect: 'narrative',
        displayName: 'Narrative',
        desk: lazy(() =>
            import('./narrative/NarrativeDesk').then((m) => ({ default: m.NarrativeDesk })),
        ),
        group: 'argument',
    },
    // The artefact itself. Last, and a group of its own, because it is what every desk above it
    // has been writing rather than another aspect of the performance.
    //
    // It was `aspect: 'result'`, which named a stage of a pipeline run — the vocabulary the
    // rewrite left behind — and was the only entry with neither a `displayName` nor a name worth
    // showing, so the menu printed a bare `result` and the bar capitalised it into a claim the
    // desk did not make. MPM is Music Performance Markup; the desk shows the markup.
    {
        aspect: 'markup',
        desk: lazy(() => import('./markup/MarkupDesk').then((m) => ({ default: m.MarkupDesk }))),
        group: 'markup',
    },
];
