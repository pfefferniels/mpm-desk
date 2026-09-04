import { lazy, type ComponentType } from 'react';
import type { ScopedTransformerViewProps } from './TransformerViewProps';
import type { Transformer } from '../fitting/transformers/Transformer';
import type { InstructionType } from '../fitting/instructions/index';

/**
 * What a desk is, as far as the registry is concerned.
 *
 * Every desk is handed the same bag, so the registry can hold them all at one type. A desk
 * written against its own transformer (`ScopedTransformerViewProps<InsertTempo>`) is assignable
 * because props are checked contravariantly: one whose `addTransformer` accepts only an
 * `InsertTempo` can be handed the editor's, which accepts any `Transformer`. No `any` needed.
 */
type DeskComponent = ComponentType<ScopedTransformerViewProps<Transformer>>;

/**
 * What a desk is allowed to know about the document when it says whether it has work to do.
 *
 * Counts rather than the alignment itself. The aspect menu imports this module and is on screen
 * before any desk is open, so handing it a fitted document would make every desk's availability a
 * function of the whole chain's output. `App` reads each count and passes it here.
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
     * nothing has been played against yet. Distinct from {@link readings}, which counts the
     * `@source` those notes name: a `<when>` outside any `<recording>` names no reading while
     * placing its note perfectly well.
     */
    aligned: number;
    /**
     * How many `<tempo>` the performance carries, over every scope.
     *
     * The whole document rather than the scope the picker is on, since the menu is drawn before a
     * desk is open. It under-gates by design: a tempo in one part opens the desk for every part.
     */
    tempos: number;
    /**
     * How many score notes the alignment still holds more than one row of.
     *
     * Off the alignment **as the chain left it**, unlike {@link readings}, which counts what the
     * document arrived with and never changes. This clears exactly when a `MakeChoice` has
     * collapsed the readings, and a ranged choice leaves it standing for the notes outside that
     * range.
     *
     * A count of notes rather than of the rows they are spread over, so it says the same thing
     * whether the document holds two takes or three. Notes only: a pedal on several readings
     * arrives with notes on several readings, and mixing the two kinds into one number would make
     * the message it appears in unsayable.
     */
    unchosen: number;
}

/**
 * Why a desk has nothing to do for the document in hand, or undefined while it has.
 *
 * The menu greys the entry and puts this in a tooltip, as the toolbar does for a control the
 * selection cannot reach. It names the remedy as well as the lack, so the reader is not left to
 * guess what makes the desk come back.
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
 * from and neither has loaded the desk yet (see `lazy` below). Required, so a new desk cannot ship
 * without it; `DeskSwitch.test.ts` checks the rows are filled in.
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
     * A name rather than the class: the editor only ever reads `.name` off it, to find the desk
     * that made a saved call, and importing fourteen classes for fourteen strings would pull the
     * whole fitting chain into the registry's chunk. The aspect menu imports the registry and is
     * on screen before any desk is open.
     *
     * Nothing checks these at compile time, and a type could not do it honestly, since the list
     * would be hand-maintained beside this one and drift the same way. `DeskSwitch.test.ts`
     * resolves every name against the real transformer registry, catching a typo, a rename and a
     * removal alike.
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
     * A correctness requirement rather than a presentation choice, which is why it is declared
     * here rather than left to each desk to remember.
     *
     * A desk plotting a residual plots *what its own dimension still has to account for*, which
     * is only that quantity if its own dimension is held out of the probe. Get it wrong and the
     * failure conceals itself: the accentuation desk's dots collapse toward zero the moment a
     * pattern is inserted, so the beat you drew a cell around is the one that disappears and the
     * desk looks like it is working.
     *
     * The transformer's own `deriveResidual` call is the authority and these match it.
     * `InsertRubato` holds out `rubato`, `InsertArticulation` `articulation`, `InsertPedal`
     * `movement`, `InsertMetricalAccentuation` `accentuationPattern`.
     *
     * Empty where a desk plots the recording raw: the dynamics desk draws recorded velocity, the
     * arpeggiation desks read recorded onsets, and neither wants anything subtracted.
     */
    holdOut?: readonly InstructionType[];

    /**
     * The instruction types this desk writes **into whichever scope the picker is on**, where a
     * part may not hold its own map beside a global one.
     *
     * MPM does not merge the two: a part's own map of a type shadows the global one outright.
     * Declaring the type here greys out whichever scope is not the one already set; `scopeLock.ts`
     * has the rule and the reasoning.
     *
     * The emphasis is the condition for declaring anything at all. Three desks that do write
     * instructions are absent, because for them the picker decides nothing: `InsertPedal` writes
     * `requireMap(mpm, 'movement', 'global')` whatever the picker says, and both style
     * transformers loop over `scopesOf(mpm)`. A lock there would describe a choice the reader
     * does not have.
     */
    writes?: readonly InstructionType[];

    /**
     * What this desk needs before it can do anything, or nothing where it always can.
     *
     * An unmet prerequisite greys the entry and says why; see {@link Prerequisite}.
     *
     * Only for a desk whose *input* is missing, never for one that starts empty and fills as it is
     * worked on. The tempo desk opens onto a blank skyline and that is where a tempo comes from.
     * The rubato desk opens onto a blank row because there is no tempo to be rubato against, and
     * nothing done on it can change that.
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
 * Every desk that draws or reads the recording wants one in hand.
 *
 * Zero aligned notes is a blank surface with no gesture on it that can write anything: the plots
 * are `msm.end` wide, which is 0, and the chords they draw from are empty. The desks that read
 * the MPM or the score instead are not gated, since the narrative, markup and metadata desks all
 * have something to do before a note has been played.
 *
 * The voices desk is the one gated over a surface that is not blank; its entry says why.
 */
const needsRecording: Prerequisite = ({ aligned }) =>
    aligned > 0 ? undefined : 'No recording is aligned yet. Align one first.';

/**
 * The two desks whose subject is where the recording falls on the *tick* grid.
 *
 * Only a `<tempo>` puts it there. Without one `residual.of(note)?.tickDate` is undefined for every
 * note, so the rubato desk draws no hooks and `InsertRubato` returns having logged, while the
 * pedal desk draws no presses and `InsertPedal` writes no `<movement>`.
 *
 * The articulation desk reads the same domain and is deliberately not gated. Three of its four
 * aspects go unmeasured without a tempo, but `relativeVelocity` comes off the rendered velocity
 * and still measures, and its unit dialog disables the other three meanwhile.
 */
const needsTempo: Prerequisite = ({ tempos }) =>
    tempos > 0 ? undefined : 'No tempo yet. Draw one on the tempo desk first.';

/**
 * Every desk that fits *from* the recording wants to know which recording it is fitting.
 *
 * A desk measures one row of the alignment at a time, and while the readings stand side by side a
 * score note has a row per take, each with its own velocity and onset under the one `xml:id`.
 * Nothing says which is on screen. `Alignment.build` keeps the first row of an id, so a plot may
 * be read against another take's rendering, and the arpeggiation desks frame a chord from the
 * earliest onset in any take to the latest, a spread no performance played.
 *
 * There is no residual to plot either: `deriveResidual` refuses an alignment on more than one
 * reading rather than answering off whichever row it kept.
 *
 * Three desks are not gated, the takes being their subject rather than their input: the alignment
 * desk is where a further recording comes from, Base Text is the remedy this points at, and the
 * corrections desk edits the recording itself.
 */
const needsChoice: Prerequisite = ({ unchosen }) =>
    unchosen === 0
        ? undefined
        : `${unchosen} notes are still on more than one reading. Choose a base text first.`;

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
 * Desks are `lazy`, so one arrives when it is opened. This module holds only what the aspect menu
 * needs to list a desk: its aspect, its group, the name it shows. The menu is built from this
 * list, so the list must stay readable without loading anything.
 */
export const correspondingDesks: DeskEntry[] = [
    // The document itself. A group of its own, so the menu sets it apart.
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
        // No hold-out: this desk plots no residual. It draws the score verovio engraves, coloured
        // by the part the chain resolved, and there is nothing for the MPM to explain away when
        // the subject is which staff a note is written on.
        //
        // Gated even though the engraving draws in full without a recording, which is the one
        // place this list makes that call. Everything the reader can do here comes out of `msm`:
        // the parts the score is coloured by, the voices the picker offers, and the bars
        // `tickRange` takes a range from. Ungated it is a whole score that answers no click,
        // reachable over any MEI whose `<performance>` times some notes but not all.
        unavailable: needsRecording,
    },
    // General: the three desks whose subject is the recording rather than the performance, in the
    // order they are used. This one is first because nothing else can say anything until the
    // score and the recording have been put note against note, and the takes it writes are what
    // Base Text then chooses between.
    //
    // No `transformerName`: the `Align` call it writes is one the chain does not run (see
    // `chain.ts`). Nothing looks for a desk by that name either, since an `Align` writes no
    // instruction and so reaches neither the narrative nor the markup desk, which is where
    // `focusCall` is reached from.
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
        // A choice needs something to choose between. With one take every preference the dialog
        // offers names the same recording, so a `MakeChoice` can only restate the document while
        // still discarding a note wherever two parts sound the same pitch at the same moment,
        // which is what its equivalence groups are keyed on.
        unavailable: ({ readings }) =>
            readings > 1
                ? undefined
                : readings === 1
                  ? 'The score has one recording, so there is no other reading to prefer.'
                  : 'No recording has been aligned into the score yet.',
    },
    // Beside Base Text: these two edit the *recording* rather than the performance, the one
    // distinction the menu's groups can make that the aspect names cannot.
    //
    // Its place in the array is load-bearing. `AspectSelect` draws a divider wherever `group`
    // changes from one entry to the next, so an entry written away from its group splits that
    // group in two on screen.
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
    // Timing, top to bottom in the order the work is done. Arpeggiation before tempo, because
    // that is where the chain puts it: `InsertDynamicsGradient` and `InsertTemporalSpread` run
    // before `InsertTempo` in `Order.ts`, reading onsets in the recording's own domain, which a
    // fitted tempo has rewritten by the time the tempo desk is done.
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
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        // Both arpeggiation desks write the same `<ornamentMap>`, so either one of them having
        // filled a scope locks the other's picker the same way. That is the document's doing, not
        // a coupling between the desks: it is one map per scope either way.
        writes: ['ornament'],
        unavailable: allOf(needsRecording, needsChoice),
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
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        writes: ['ornament'],
        unavailable: allOf(needsRecording, needsChoice),
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
                {
                    gesture: 'Backspace',
                    does: 'delete the selected boxes, else remove the selected call',
                },
            ],
        },
        writes: ['tempo'],
        // The recording, and only the recording: the skyline is the recording's own inter-onset
        // intervals, so this desk is where a tempo comes from and cannot want one.
        unavailable: allOf(needsRecording, needsChoice),
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
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        holdOut: ['rubato'],
        writes: ['rubato'],
        unavailable: allOf(needsRecording, needsChoice, needsTempo),
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
                { gesture: 'Backspace', does: 'remove the selected call, closer and all' },
            ],
        },
        writes: ['dynamics'],
        unavailable: allOf(needsRecording, needsChoice),
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
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        holdOut: ['accentuationPattern'],
        writes: ['accentuationPattern'],
        // No tempo: the residual this plots is the velocity half, which espressivo renders
        // whether or not anything has placed the notes on the tick grid.
        unavailable: allOf(needsRecording, needsChoice),
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
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        holdOut: ['articulation'],
        writes: ['articulation'],
        // Recording only — see the note on `needsTempo` for why this desk is left open without one.
        unavailable: allOf(needsRecording, needsChoice),
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
                    gesture: 'Click a press on its left half',
                    does: 'write the pedal going down, where the foot lands',
                },
                {
                    gesture: 'Click a press on its right half',
                    does: 'write it coming up, where the foot lifts',
                },
                { gesture: 'Hover a chord line', does: 'sound the chord' },
                { gesture: 'Click a movement', does: 'select the call that wrote it' },
                { gesture: 'Backspace', does: 'remove the selected call' },
            ],
        },
        // A recorded pedal has no symbolic date of its own; the residual is the only thing that
        // can put one on the tick grid at all.
        holdOut: ['movement'],
        unavailable: allOf(needsRecording, needsChoice, needsTempo),
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
                { gesture: 'Backspace', does: 'remove the selected calls' },
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
    // has been writing rather than another aspect of the performance. Named for what it shows:
    // MPM is Music Performance Markup.
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
