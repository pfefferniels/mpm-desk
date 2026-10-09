import type { ComponentType } from 'react';
import type { ScopedTransformerViewProps } from '../TransformerViewProps';
import type { Transformer } from '../../fitting/transformers/Transformer';
import type { InstructionType } from '../../fitting/instructions/index';

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
export type Prerequisite = (facts: DocumentFacts) => string | undefined;

/**
 * One thing the reader can do on a desk.
 *
 * A key counts as a gesture here. Splitting the two would buy a heading on the five desks that
 * have both and an empty half on the rest, and the reader is looking for "how do I do X", not for
 * which input device X belongs to.
 */
interface DeskAction {
    /** How it is performed — `Shift-click a box`, `Drag in Draw mode`, `Esc`. */
    gesture: string;
    /** What it does. A phrase, MPM assumed. */
    does: string;
}

/**
 * What a desk is for, and what can be done on it.
 *
 * Here rather than in each desk, because the aspect menu and the app bar are what the reader asks
 * from and neither has loaded the desk yet (see `lazy` in `DeskSwitch.tsx`). Required, so a new desk cannot ship
 * without it; `DeskSwitch.test.ts` checks the rows are filled in.
 */
export interface DeskHelp {
    /** What the desk shows, in a line. */
    summary: string;
    /** Pointer first, then keys. Absent on a desk that is only read. */
    actions?: readonly DeskAction[];
}

export interface DeskEntry {
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
    /** Which run of the aspect menu it is listed in; see {@link inGroup}. */
    group: DeskGroup;
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

/** The runs the aspect menu sets apart, in the order `DeskSwitch.tsx` lists them. */
export type DeskGroup =
    | 'document'
    | 'general'
    | 'timing'
    | 'dynamics'
    | 'pedalling'
    | 'argument'
    | 'markup';

/**
 * A group's desks, each stamped with the group.
 *
 * One file per group, written without the key, so an entry cannot name a group other than the
 * one it is listed under and split that group in two on screen.
 */
export const inGroup = (
    group: DeskGroup,
    entries: readonly Omit<DeskEntry, 'group'>[],
): DeskEntry[] => entries.map((entry) => ({ ...entry, group }));

