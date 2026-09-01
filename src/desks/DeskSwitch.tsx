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

/**
 * What a desk is allowed to know about the document when it says whether it has work to do.
 *
 * Deliberately a handful of counts rather than the alignment itself. The aspect menu is on screen
 * before any desk is open and this module is what it imports; handing it a fitted document would
 * make every desk's availability a function of the whole chain's output, and put the temptation of
 * reading one there. A count off that document is a different thing: it names one quantity, and
 * {@link tempos} is one, so `App` reads it there and passes it here.
 */
export interface DocumentFacts {
    /**
     * How many readings of the score are in hand — `<recording>` elements, before any choice.
     *
     * Counted off the alignment as loaded, for the reason `Alignment.sources` records.
     */
    readings: number;
    /**
     * How many notes the recording placed, likewise off the alignment as loaded.
     *
     * `asMSM` keeps a note only where the MEI's `<performance>` timed it, so zero is a score
     * nothing has been played against yet. It is not {@link readings}, which counts the `@source`
     * those notes name: a `<when>` written outside any `<recording>` names no reading while
     * placing its note perfectly well, and a desk greyed out on that document would be greyed out
     * over a recording that is there.
     */
    aligned: number;
    /**
     * How many `<tempo>` the performance carries, over every scope.
     *
     * The whole document rather than the scope the picker is on, because the menu is drawn before
     * a desk is open and a row that came and went with the picker would be the wrong kind of
     * answer. It under-gates by design: a tempo in one part opens the desk for every part.
     */
    tempos: number;
}

/**
 * Why a desk has nothing to do for the document in hand, or undefined while it has.
 *
 * The reason is shown, not swallowed: the menu greys the entry and puts this in a tooltip, the way
 * the toolbar does for a control the selection cannot reach. So it names the remedy as well as the
 * lack — a desk that only said it was unavailable would leave the reader to guess what makes it
 * come back.
 */
type Prerequisite = (facts: DocumentFacts) => string | undefined;

/**
 * One thing the reader can do on a desk.
 *
 * A key counts as a gesture here. Splitting the two would buy a heading on the five desks that
 * have both and an empty half on the rest, and the reader is looking for "how do I do X", not for
 * which input device X belongs to.
 */
export interface DeskAction {
    /** How it is performed — `Shift-click a box`, `Drag in Draw mode`, `Esc`. */
    gesture: string;
    /** What it does. A phrase, MPM assumed. */
    does: string;
}

/**
 * What a desk is for, and what can be done on it.
 *
 * Here rather than in each desk, because the aspect menu and the app bar are what the reader asks
 * from, and neither of them has loaded the desk yet — see the note on `lazy` below. Required, so a
 * new desk cannot ship without it; `DeskSwitch.test.ts` checks the rows are filled in.
 */
export interface DeskHelp {
    /** What the desk shows, in a line. */
    summary: string;
    /** Pointer first, then keys. Absent on a desk that is only read. */
    actions?: readonly DeskAction[];
}

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
    /** What this desk is for, and what can be done on it — the info button in the app bar. */
    help: DeskHelp;
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

    /**
     * The instruction types this desk writes **into whichever scope the picker is on**, where a
     * part may not hold its own map beside a global one.
     *
     * MPM does not merge the two: a part's own map of a type shadows the global one of that type
     * outright. Declaring the type here greys out whichever scope is not the one already set —
     * `scopeLock.ts` has the rule and the reasoning.
     *
     * The emphasis is the condition for declaring anything at all. Three desks that do write
     * instructions are deliberately absent, because for them the picker decides nothing: the
     * pedal desk's `InsertPedal` writes `requireMap(mpm, 'movement', 'global')` whatever the
     * picker says, and both style transformers loop over `scopesOf(mpm)` and restyle every scope
     * they find. A lock on those would describe a choice the reader does not have.
     */
    writes?: readonly InstructionType[];

    /**
     * What this desk needs before it can do anything, or nothing where it always can.
     *
     * A desk that simply vanished from the list would leave the reader to guess what makes it come
     * back, so an unmet prerequisite greys the entry and says why — see {@link Prerequisite}.
     *
     * Only for a desk whose *input* is missing, never for one that merely starts empty and fills
     * as it is worked on. The tempo desk opens onto a blank skyline and that is where a tempo comes
     * from; the rubato desk opens onto a blank row because there is no tempo to be rubato against,
     * and nothing done on it can change that.
     */
    unavailable?: Prerequisite;
}

/**
 * The first prerequisite the document does not meet, in the order they are named.
 *
 * So a desk that wants a tempo names the recording first: with nothing aligned there is no tempo
 * to draw either, and being sent to the tempo desk to fit one would be a second dead end.
 */
const allOf =
    (...checks: readonly Prerequisite[]): Prerequisite =>
    (facts) =>
        checks.map((check) => check(facts)).find((reason) => reason !== undefined);

/**
 * Every desk that plots the recording wants one to plot.
 *
 * Zero aligned notes is a blank surface with no gesture on it that can write anything: the plots
 * are `msm.end` wide, which is 0, and the chords they draw from are empty. The desks that read the
 * MPM or the score instead are not gated — the narrative, markup, metadata and voices desks all
 * have something to show and something to do before a note has been played.
 */
const needsRecording: Prerequisite = ({ aligned }) =>
    aligned > 0 ? undefined : 'No recording is aligned yet. Align one first.';

/**
 * The two desks whose subject is where the recording falls on the *tick* grid.
 *
 * Only a `<tempo>` puts it there. Without one `residual.of(note)?.tickDate` is undefined for every
 * note, so the rubato desk draws no hooks and `InsertRubato` returns having logged; the pedal desk
 * draws no presses, and `InsertPedal` writes no `<movement>` at all.
 *
 * The articulation desk reads the same domain and is deliberately not gated: three of its four
 * aspects go unmeasured without a tempo, but `relativeVelocity` is taken off the rendered velocity
 * and still measures, so the desk can write an articulation that means something. Its unit dialog
 * disables the other three while nothing places the notes on the tick grid, so the desk cannot
 * write a definition that states nothing.
 */
const needsTempo: Prerequisite = ({ tempos }) =>
    tempos > 0 ? undefined : 'No tempo yet. Draw one on the tempo desk first.';

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
        help: {
            summary:
                'Title and author, set as a title page, over a count of what the document holds.',
            actions: [
                { gesture: 'Click a line', does: 'edit it in place. Leaving the field commits' },
                { gesture: 'Enter', does: 'commit and leave the field' },
                { gesture: 'Esc', does: 'discard the edit' },
            ],
        },
    },
    // Beside metadata, in the document's own group: which MEI voice goes into which MSM part is a
    // statement about the score's encoding rather than about a dimension of the sound, and it is
    // upstream of everything — it decides what the scope picker offers every other desk.
    {
        transformerName: 'ProcessVoices',
        aspect: 'voices',
        desk: lazy(() => import('./voices/VoicesDesk').then((m) => ({ default: m.VoicesDesk }))),
        group: 'document',
        help: {
            summary:
                'Which MEI voice goes into which MSM part: the engraved score coloured by part, ' +
                'with the parts listed beside it.',
            actions: [
                { gesture: 'Click a notehead', does: 'select that note' },
                { gesture: '⌘-click a notehead', does: 'add it to the selection, or drop it' },
                { gesture: 'Hover a part', does: 'fade every other part in the score' },
                { gesture: 'Click a part', does: 'select it alone' },
                { gesture: '⌘-click a part', does: 'add it. Two or more allow Combine' },
                { gesture: 'Click a voice chip', does: 'pick that voice whole, for Move to…' },
                { gesture: 'Esc', does: 'drop the notes, the voice and the parts' },
                { gesture: 'Enter, Esc in a name field', does: 'commit, revert the rename' },
            ],
        },
        // No hold-out: `holdOut` is for a desk that plots a residual, and this one never asks for
        // one. It draws the score verovio engraves and colours it by the part the chain resolved,
        // and there is nothing for the MPM to explain away when the subject is which staff a note
        // is written on.
    },
    // General — the three desks whose subject is the recording rather than the performance, in
    // the order they are used. This one is first because nothing else can say anything until it
    // has: until the score and the recording have been put note against note there is no
    // recording to fit to, and the takes it writes are what Base Text then chooses between.
    //
    // No `transformerName`: the `Align` call it writes is one the chain does not run, so there is
    // no transformer to name — see `chain.ts`. Nothing looks for a desk by that name either,
    // because an `Align` writes no instruction and so reaches neither the narrative nor the
    // markup desk, which is where `focusCall` is reached from.
    {
        aspect: 'alignment',
        desk: lazy(() =>
            import('./alignment/AlignmentDesk').then((m) => ({ default: m.AlignmentDesk })),
        ),
        group: 'general',
        help: {
            summary:
                'Which sounding event realises which written note. Align runs the model and ' +
                'leaves a draft; Apply writes it into the score.',
            actions: [
                {
                    gesture: 'Click a disagreement mark',
                    does: 'open its question: a cross, a bracket or a coloured notehead',
                },
                { gesture: 'Click elsewhere in the score', does: 'close it' },
                { gesture: 'Drag the range slider', does: 'narrow what the transport plays' },
            ],
        },
    },
    {
        aspect: 'source choice',
        displayName: 'Base Text',
        desk: lazy(() => import('./choice/ChoiceDesk').then((m) => ({ default: m.ChoiceDesk }))),
        transformerName: 'MakeChoice',
        group: 'general',
        help: {
            summary:
                'Every reading on one roll, a brace over each set of readings of a note, so that ' +
                'one source can be preferred for the piece or for a narrower scope.',
            actions: [
                { gesture: 'Click a note', does: 'scope the choice to it' },
                {
                    gesture: '⌘-click a note',
                    does: 'add it, where a note scope is already standing',
                },
                { gesture: 'Shift-click a later note', does: 'reach from the scope to it' },
            ],
        },
        // A choice needs something to choose between. With one take the desk draws that take's
        // notes under a curly brace that brackets nothing, and every preference the dialog offers
        // names the same recording, so a `MakeChoice` here can only restate what the document
        // already says — while still discarding a note wherever two parts sound the same pitch at
        // the same moment, which is what its equivalence groups are keyed on.
        unavailable: ({ readings }) =>
            readings > 1
                ? undefined
                : readings === 1
                  ? 'The score has one recording, so there is no other reading to prefer.'
                  : 'No recording has been aligned into the score yet.',
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
        help: {
            summary:
                'What the roll scan read wrong. A Modify corrects the recording itself, so it ' +
                'writes no instruction; a drag is a draft until Apply.',
            actions: [
                { gesture: 'Press a note or pedal', does: 'select it' },
                { gesture: '⌘-press', does: 'add it to the selection, or drop it' },
                { gesture: 'Shift-press', does: 'reach from the selection to it' },
                {
                    gesture: 'Drag up or down',
                    does: 'shift velocity by whole steps, on the Velocity plot',
                },
                {
                    gesture: 'Drag sideways',
                    does: 'shift the onset, on the Timing plot. Near the right edge, the release',
                },
                { gesture: 'Hover a dot', does: 'sound the chord there, on the Velocity plot' },
                { gesture: 'Esc', does: 'drop the selection and the drawn correction' },
            ],
        },
        // No hold-out: like the dynamics desk, this one plots the recording raw. There is nothing
        // for the MPM to explain away when the subject is what the roll scan read.
        unavailable: needsRecording,
    },
    // Timing, read top to bottom in the order the work is done. Arpeggiation before tempo, because
    // that is where the chain puts it: `InsertDynamicsGradient` and `InsertTemporalSpread` both run
    // before `InsertTempo` in `Order.ts`, and they read onsets in the recording's own domain, which
    // a fitted tempo has already rewritten by the time the tempo desk is done.
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
        help: {
            summary:
                "Each chord's measured onset spread as a block, over the local tempo " +
                'variance, with the spreads already written in a strip below.',
            actions: [
                { gesture: 'Hover a chord', does: 'sound it, and read its frame in ms' },
                { gesture: 'Click a chord', does: 'select it for Insert' },
                {
                    gesture: 'Insert Default',
                    does: "spread every chord in the scope whose roll is longer than the dialog's "
                        + 'Duration Threshold, in ms',
                },
                {
                    gesture: 'Hover a written spread',
                    does: 'audition the roll as that ornament specifies it',
                },
                { gesture: 'Click a written spread', does: 'select the call that wrote it' },
            ],
        },
        // Both arpeggiation desks write the same `<ornamentMap>`, so either one of them having
        // filled a scope locks the other's picker the same way. That is the document's doing, not
        // a coupling between the desks: it is one map per scope either way.
        writes: ['ornament'],
        unavailable: needsRecording,
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
        help: {
            summary:
                "The recorded velocities over time: a hull joining each chord's softest and " +
                "loudest note to the next chord's, with the gradients already written over it.",
            actions: [
                {
                    gesture: 'Hover a chord',
                    does: 'sound it. A handle follows the pointer up and down',
                },
                { gesture: 'Click the handle', does: 'write a ramp with its zero at that height' },
                {
                    gesture: "Click the chord's line",
                    does: 'write a ramp over the measured extremes',
                },
                { gesture: 'Click a written gradient', does: 'select the call that wrote it' },
            ],
        },
        writes: ['ornament'],
        unavailable: needsRecording,
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
        help: {
            summary:
                'One point per fitted ornament, frame start against frame length, coloured by the ' +
                'definition the clustering would put it in.',
            actions: [
                {
                    gesture: 'Drag a tolerance',
                    does: 're-cluster the preview. Nothing is written until Stylize Ornaments',
                },
            ],
        },
    },
    {
        transformerName: 'InsertTempo',
        desk: lazy(() => import('./tempo/TempoDesk').then((m) => ({ default: m.TempoDesk }))),
        aspect: 'tempo',
        group: 'timing',
        help: {
            summary:
                "The recording's tempo as a skyline of boxes against seconds, with the tempo " +
                'curves already in the document drawn over it.',
            actions: [
                { gesture: 'Hover a box', does: 'sound the passage it covers' },
                { gesture: 'Click a box', does: 'select it alone' },
                { gesture: 'Shift-click a box', does: 'add it to the selection' },
                { gesture: 'Shift+Alt-click a box', does: 'remove it' },
                {
                    gesture: 'Drag in Draw mode',
                    does: 'draw a curve. The whole stroke is fitted, so its shape sets the bend',
                },
                {
                    gesture: "Drag from a curve's end",
                    does: "continue it at that curve's beat length",
                },
                {
                    gesture: 'Click a box in Split mode',
                    does: 'split it in the middle of its tick range',
                },
                {
                    gesture: 'Hover a written curve',
                    does: 'hear the passage re-timed by it, over a click',
                },
                { gesture: 'Click a written curve', does: 'select the call that wrote it' },
                { gesture: 'Esc', does: 'deselect, and cancel the stroke in hand' },
                { gesture: 'c', does: 'combine the selected boxes' },
                { gesture: 's', does: 'toggle Split mode' },
                { gesture: 'Backspace', does: 'delete the selected boxes' },
            ],
        },
        writes: ['tempo'],
        // The recording, and only the recording: the skyline is the recording's own inter-onset
        // intervals, so this desk is where a tempo comes from and cannot want one.
        unavailable: needsRecording,
    },
    {
        transformerName: 'InsertRubato',
        desk: lazy(() => import('./rubato/RubatoDesk').then((m) => ({ default: m.RubatoDesk }))),
        aspect: 'rubato',
        group: 'timing',
        help: {
            summary:
                'Every chord hooked from its score date to where the recording put it, with ' +
                'rubato held out of the fit, so the displacement drawn is what a rubato would ' +
                'have to account for.',
            actions: [
                { gesture: 'Hover the row', does: 'sound the nearest date, and read its tick' },
                {
                    gesture: 'Click twice',
                    does: 'mark a frame between the two dates, either order',
                },
                { gesture: 'Click again', does: 'start a new frame, discarding the last' },
                { gesture: 'Click the frame', does: 'audition the passage it covers' },
                {
                    gesture: 'Click a written rubato',
                    does: 'hear its frame warped, and select the call that wrote it',
                },
            ],
        },
        holdOut: ['rubato'],
        writes: ['rubato'],
        unavailable: allOf(needsRecording, needsTempo),
    },
    // Dynamics
    {
        transformerName: 'InsertDynamicsInstructions',
        aspect: 'dynamics',
        desk: lazy(() =>
            import('./dynamics/DynamicsDesk').then((m) => ({ default: m.DynamicsDesk })),
        ),
        group: 'dynamics',
        help: {
            summary:
                'One dot per recorded velocity per chord, with the fitted dynamics curves over ' +
                'them and a grey ghost where a velocity was corrected by hand. A curve is fitted ' +
                'between two anchors: a chord onset, or a phantom velocity pencilled in on the ' +
                'grid where the recording sounds nothing.',
            actions: [
                { gesture: 'Hover a dot', does: 'sound the chord there' },
                { gesture: 'Click a dot', does: 'play from that date to the end' },
                {
                    gesture: 'Drag across the plot',
                    does: 'fit a curve between two anchors, in Insert mode',
                },
                {
                    gesture: 'Click a dot in Phantom mode',
                    does: 'pencil in a phantom velocity there',
                },
                {
                    gesture: 'Click the plot in Phantom mode',
                    does: 'pencil one in on the grid, over a rest or inside a held note',
                },
                { gesture: 'Click a phantom', does: 'pick it for ↑ ↓' },
                { gesture: '↑ ↓', does: 'nudge the phantom last picked by one' },
                { gesture: 'Shift+Alt-click a phantom', does: 'remove it' },
                { gesture: 'Click a curve', does: 'select the call that wrote it' },
            ],
        },
        writes: ['dynamics'],
        unavailable: needsRecording,
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
        help: {
            summary:
                'The velocity residual, recorded minus what the MPM already renders, one dot per ' +
                'chord, with the accentuation patterns written over it.',
            actions: [
                { gesture: 'Hover a dot', does: 'sound the chord there' },
                { gesture: 'Click the plot', does: 'start a candidate range at the nearest dot' },
                { gesture: 'Move the pointer', does: 'draw the range out to the dot under it' },
                { gesture: 'Click again', does: 'close the range there' },
                { gesture: 'Shift-click', does: "move the candidate's nearer end to that dot" },
                { gesture: 'Esc, Shift+Alt-click the candidate', does: 'clear it' },
                { gesture: 'Click a pattern', does: 'select the call that wrote it' },
                { gesture: 'Shift-click a pattern', does: 'add it to the merge selection' },
            ],
        },
        holdOut: ['accentuationPattern'],
        writes: ['accentuationPattern'],
        // No tempo: the residual this plots is the velocity half, which espressivo renders
        // whether or not anything has placed the notes on the tick grid.
        unavailable: needsRecording,
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
        help: {
            summary:
                'Recorded release against notated release, one bar per note: pitch on the ' +
                'vertical, bar thickness by velocity residual, the notated release a dashed tick.',
            actions: [
                { gesture: 'Hover a note', does: 'sound it' },
                { gesture: 'Click a note', does: 'start a unit with it' },
                { gesture: 'Shift-click a note', does: 'add it to the unit, or drop it' },
                {
                    gesture: 'Click an articulated note',
                    does: 'select the call that wrote it. Such a note joins no unit',
                },
            ],
        },
        holdOut: ['articulation'],
        writes: ['articulation'],
        // Recording only — see the note on `needsTempo` for why this desk is left open without one.
        unavailable: needsRecording,
    },
    {
        transformerName: 'StylizeArticulation',
        aspect: 'articulation',
        displayName: 'Style',
        desk: lazy(() =>
            import('./styles/ArticulationStyles').then((m) => ({ default: m.ArticulationStyles })),
        ),
        group: 'dynamics',
        help: {
            summary:
                'One point per articulation in scope, relative duration against relative volume, ' +
                'coloured by cluster. Both axes are ratios against the notated value, so 1 is a ' +
                'place on each.',
            actions: [
                {
                    gesture: 'Drag a tolerance',
                    does: 're-cluster the preview. Nothing is written until Stylize Articulations',
                },
            ],
        },
    },
    // Pedalling
    {
        transformerName: 'InsertPedal',
        aspect: 'pedalling',
        desk: lazy(() => import('./pedal/PedalDesk').then((m) => ({ default: m.PedalDesk }))),
        group: 'pedalling',
        help: {
            summary:
                'The recorded pedal presses on the tick grid, sustain over soft, with the ' +
                'movements already written below, one lane per controller.',
            actions: [
                {
                    gesture: 'Click a pedal block',
                    does: 'open its dialog to write a movement over it',
                },
                { gesture: 'Hover a chord line', does: 'sound the chord' },
                { gesture: 'Click a movement', does: 'select the call that wrote it' },
            ],
        },
        // A recorded pedal has no symbolic date of its own; the residual is the only thing that
        // can put one on the tick grid at all.
        holdOut: ['movement'],
        unavailable: allOf(needsRecording, needsTempo),
    },
    // The argument
    {
        aspect: 'narrative',
        displayName: 'Narrative',
        desk: lazy(() =>
            import('./narrative/NarrativeDesk').then((m) => ({ default: m.NarrativeDesk })),
        ),
        group: 'argument',
        help: {
            summary:
                'The instructions grouped into claims, in score order, with those belonging to no ' +
                'claim listed at the bottom. A working view, so it is a table.',
            actions: [
                {
                    gesture: 'Click an instruction chip',
                    does: 'select its call, and hear that one instruction over its reach',
                },
                {
                    gesture: 'Hover a gesture',
                    does: "quote the element's attributes below the row",
                },
                {
                    gesture: 'Click assign',
                    does: "move the selected instructions into that row's segment",
                },
                { gesture: 'Click dissolve', does: 'ungroup it. The instructions survive' },
                { gesture: 'Type in Word', does: 'say what the claim says. It saves as you type' },
            ],
        },
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
        help: {
            summary:
                'The document as text: the MPM every other desk has been writing, and the MSM it ' +
                'was fitted against. There is no find field; the browser already has one.',
            actions: [
                {
                    gesture: 'Click a line in the MPM',
                    does: 'open the desk that wrote that element, where a call claims it',
                },
            ],
        },
    },
];
