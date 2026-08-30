/**
 * Every edit a work file can undergo, as one pure function — and undo/redo over it.
 *
 * These edits lived in `App.tsx`, one `setWork` updater each. They move here for two reasons,
 * and neither is tidiness:
 *
 * - **The rules hold *between* the two arrays.** A call names the claim it is made under and a
 *   claim exists because calls are made under it, so removing a call can retire a segment and
 *   creating a segment is meaningless until a call points at it. A rule like that, written into
 *   a component, holds wherever somebody remembered to write it. Written here, it holds because
 *   there is nowhere else to write.
 * - **Undo needs an edit to be a value.** As long as an edit is a closure over `setWork`, the
 *   only record of what the document was is the document. As an action applied to a state, the
 *   before is still there when the after arrives, which is all {@link workHistoryReducer} needs.
 *
 * What stays in the component is what is not the document: which desk is open, which calls are
 * lit, the zoom, the snackbar. Those are how somebody is looking at a reconstruction, not what
 * it says.
 *
 * ## Pure, and pure on purpose
 *
 * No `crypto.randomUUID()`, no `Date.now()`, no mutation of the state or of anything reachable
 * from it. Where an edit needs a fresh id it arrives in the action — see
 * {@link WorkAction} `set-metadata` — because a reducer that invents one produces a different
 * answer every time it is asked the same question, and the whole point of the history below is
 * that asking twice is a thing that happens.
 *
 * An edit that changes nothing returns the state it was given, **by reference**. That is not an
 * optimisation: it is how {@link workHistoryReducer} tells a real edit from a dead one without
 * comparing two work files, which it could not do honestly anyway — `options` holds `Map`s and
 * `Set`s (see {@link Call}) and no cheap deep-equal walks into those correctly.
 */

import type { Call, Segment, WorkFile } from './Work';
import type {
    PartLayout,
    VoiceMove,
    VoiceSelection,
} from '../fitting/transformers/voices/ProcessVoices';
import type { Action, Resolution } from '../alignment/readings';
import type { MlignModelId } from '../alignment/mlign/models';

/** The empty document the editor starts on, before a file is opened. */
export const EMPTY_WORK: WorkFile = { name: '', mei: '', mpm: '', provenance: [], segments: [] };

/**
 * The desk bag, as much of it as this file is allowed to know.
 *
 * `Record<string, unknown>` and it stays that way. The shape belongs to the desks — today the
 * tempo skyline's boxes, its hand-marked silent onsets, its drawn trails — and importing it
 * would point the document at the desks that edit it, which is backwards. The reducer carries
 * the bag; it never opens it.
 */
export type Secondary = NonNullable<WorkFile['secondary']>;

/** Exposed to desks as a `React.Dispatch<React.SetStateAction<…>>`, so both forms have to work. */
export type SecondaryUpdate = Secondary | ((previous: Secondary) => Secondary);

/** What the metadata desk edits: the two fields that have a UI. */
export interface WorkMetadata {
    author: string;
    title: string;
}

export type MetadataUpdate = WorkMetadata | ((previous: WorkMetadata) => WorkMetadata);

/** Every way the document changes. */
export type WorkAction =
    /** A whole file, opened. Replaces the document — and, in the history below, forgets the past. */
    | { type: 'load'; work: WorkFile }
    /** What a desk's gesture becomes. Lands under no claim; see {@link ungrouped}. */
    | { type: 'add-call'; call: Call }
    /** Calls, deleted. Takes any claim nothing is left under with them. */
    | { type: 'remove-calls'; ids: readonly string[] }
    /** Calls put under a claim — an existing one, a new one, or none at all. */
    | { type: 'group-calls'; callIds: readonly string[]; segment: Segment | null }
    /** A claim withdrawn. Its calls survive, unclaimed. */
    | { type: 'dissolve-segment'; segmentId: string }
    /** The claims themselves rewritten — in practice, one segment's prose edited. */
    | { type: 'set-segments'; segments: Segment[] }
    /** The desk bag replaced, or updated from its previous value. */
    | { type: 'set-secondary'; update: SecondaryUpdate }
    /**
     * Title and author. The write half of the pair under *title and author* below, which is
     * where the reason they travel on the chain rather than beside it is written down.
     *
     * `newCallId` is used only when the chain carries no such call yet. It arrives in the action
     * rather than being generated here so that this stays a function of its arguments.
     */
    | { type: 'set-metadata'; update: MetadataUpdate; newCallId: string }
    /**
     * The voice layout, edited in place on the one `ProcessVoices` call.
     *
     * A layout is a *state*, not a sequence of gestures: a call per combine would make undo mean
     * "take back one click" rather than "go back to the layout before", and would leave the part
     * numbers every other call names as an emergent property of the whole sequence.
     *
     * `newCallId` arrives in the action for the reason `set-metadata`'s does — the reducer stays a
     * function of its arguments.
     */
    | { type: 'set-voices'; update: VoicesUpdate; newCallId: string }
    /**
     * What was decided about one take, on the one `Align` call that names its `@source`.
     *
     * A whole value rather than an updater: the desk holds the review it is conducting, so it
     * always knows the alignment it means. `newCallId` arrives in the action for the reason the
     * two above give — the reducer stays a function of its arguments.
     */
    | { type: 'set-alignment'; alignment: WorkAlignment; newCallId: string };

/**
 * A call with its `segment` taken off.
 *
 * Deleted rather than set to `undefined`: `JSON.stringify` drops an undefined value, so the two
 * write the same file — but only one of them says so in the object anybody reads in a debugger.
 */
const ungrouped = (call: Call): Call => {
    const next = { ...call };
    delete next.segment;
    return next;
};

/** Shared so that a bag that was never there and a bag emptied to `{}` compare as one thing. */
const NO_SECONDARY: Secondary = {};

/** True when `next` is the same list, entry for entry, as `previous`. */
const sameEntries = <T>(next: readonly T[], previous: readonly T[]): boolean =>
    next.length === previous.length && next.every((entry, index) => entry === previous[index]);

// ── title and author ──────────────────────────────────────────────
//
// **Not editor state beside the document.** The runner builds `<metadata>` out of whatever
// `InsertMetadata` call the chain carries, so a title held anywhere else would be a second copy
// the next fit ignores: it would show in the app bar and be missing from the MPM.
//
// Which is why the read below and the `set-metadata` case above are one thing, and why they are
// written next to each other. They have to agree about a shape neither of them owns — `options`
// is `Record<string, unknown>`, and the file may hold anything — and a reader looking for the
// title somewhere other than where the writer puts it loses the title on the round trip without
// anything failing anywhere.

/**
 * The first `text` in what should be a list of `{ text }` — `undefined`, a number, a file that
 * says something else entirely, all read as "nothing said".
 *
 * Reading rather than casting, because `options` is what a file happened to contain: it is typed
 * `Record<string, unknown>` for the honest reason, and a cast here would be this module claiming
 * to know a shape it has not checked.
 */
const firstText = (value: unknown): string => {
    if (!Array.isArray(value)) return '';
    const first: unknown = value[0];
    if (typeof first !== 'object' || first === null || !('text' in first)) return '';
    return typeof first.text === 'string' ? first.text : '';
};

/**
 * The title and author, read off the chain's `InsertMetadata` call.
 *
 * Exported because everything that shows them — the app bar, the metadata desk, the document
 * title — wants them without dispatching anything.
 *
 * The *first* such call wins, and a file holding two is left holding two: the chain would run
 * both, and quietly reading one here would hide that rather than fix it.
 */
export const metadataOf = (work: WorkFile): WorkMetadata => {
    const options = work.provenance.find((entry) => entry.name === 'InsertMetadata')?.options;
    return {
        author: firstText(options?.['authors']),
        title: firstText(options?.['comments']),
    };
};

// ── the voice layout ──────────────────────────────────────────────
//
// The same arrangement as the title above, for the same reason: the layout travels on the chain,
// as the options of the one `ProcessVoices` call, so a copy held anywhere else is one the next fit
// ignores. Reader and writer are written next to each other because they have to agree about a
// shape neither of them owns.

/**
 * What the voices desk edits: the layout, as parts and the moves that override it.
 *
 * Typed in `ProcessVoices`'s own vocabulary rather than in a second shape of its own. The two
 * would otherwise describe the same fact twice and be free to drift, which is exactly what the
 * reader below and the transformer cannot afford — the transformer is the only thing that acts on
 * it. `exportWork` reaches for `MakeChoiceOptions` the same way and for the same reason.
 */
export interface WorkVoices {
    parts: readonly PartLayout[];
    moves: readonly VoiceMove[];
}

export type VoicesUpdate = WorkVoices | ((previous: WorkVoices) => WorkVoices);

/** The empty layout — one part per staff, which is what the conversion already produced. */
const NO_VOICES: WorkVoices = { parts: [], moves: [] };

const readParts = (value: unknown): WorkVoices['parts'] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const part = entry as Record<string, unknown>;
        if (typeof part['number'] !== 'number') return [];
        return [
            {
                number: part['number'],
                name: typeof part['name'] === 'string' ? part['name'] : '',
                voices: Array.isArray(part['voices'])
                    ? part['voices'].filter((v: unknown): v is string => typeof v === 'string')
                    : [],
            },
        ];
    });
};

/**
 * A move's selector, validated into one of the two forms the transformer acts on.
 *
 * Validated here rather than carried as an opaque bag, so that a selector the transformer could
 * not use is dropped at the boundary instead of silently matching nothing later.
 */
const readSelection = (value: unknown): VoiceSelection | null => {
    if (typeof value !== 'object' || value === null) return null;
    const select = value as Record<string, unknown>;

    if (Array.isArray(select['noteIDs'])) {
        return { noteIDs: select['noteIDs'].filter((id: unknown): id is string => typeof id === 'string') };
    }
    if (
        typeof select['voice'] === 'string' &&
        typeof select['from'] === 'number' &&
        typeof select['to'] === 'number'
    ) {
        return { voice: select['voice'], from: select['from'], to: select['to'] };
    }
    return null;
};

const readMoves = (value: unknown): WorkVoices['moves'] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const move = entry as Record<string, unknown>;
        if (typeof move['part'] !== 'number') return [];
        const select = readSelection(move['select']);
        if (!select) return [];
        return [{ part: move['part'], select }];
    });
};

/**
 * The layout, read off the chain's `ProcessVoices` call.
 *
 * Read structurally rather than cast, for the reason {@link firstText} gives: `options` is what a
 * file happened to contain. The *first* such call wins and a file holding two is left holding two,
 * as with metadata.
 */
export const voicesOf = (work: WorkFile): WorkVoices => {
    const options = work.provenance.find((entry) => entry.name === 'ProcessVoices')?.options;
    if (!options) return NO_VOICES;
    return { parts: readParts(options['parts']), moves: readMoves(options['moves']) };
};

/**
 * Part `@number` ⇒ name, for the places a part's name is written out: the MSM `Alignment.build`
 * serializes, the archive's `score.msm`, and the rendered MIDI's track names.
 *
 * A part nobody named is left out, so it keeps the `part<index>` `Alignment.build` has always
 * written.
 */
export const partNamesOf = (work: WorkFile): Map<number, string> => {
    const names = new Map<number, string>();
    for (const part of voicesOf(work).parts) {
        if (part.name) names.set(part.number, part.name);
    }
    return names;
};

// ── the alignment ─────────────────────────────────────────────────
//
// The third of these, and the one that is *not* a transformer call.
//
// What a reader decides about the score and the recording disagreeing — that this run of played
// notes is the trill the score already writes, that those written notes were passed over, who
// decided and how sure they were — is written into the MEI by `applyAlignment`, and the MEI is
// what the chain then runs over. So by the time there is an `Alignment` to fit, the decision has
// already been applied and there is nothing left for a `transform` to do; `chain.ts` says so, and
// says it in a list rather than in an empty transformer.
//
// One thing does not survive the MEI, and it is why this is recorded at all: an {@link Action}.
// A `<when>` carries the reading, the responsibility and the certainty, and nothing there says
// what was to be *done* about it — whether the played notes are to be written into the score,
// whether the unplayed ones are a marked simplification. That is a decision, so the document
// keeps it, and keeps it beside the settings the run was made with so the run can be made again.
//
// One call per take, unlike the two above: a score may be aligned against several performances,
// and each is its own decision about its own <recording>.

/** What the alignment desk records about one take. */
export interface WorkAlignment {
    /** The `<recording @source>` this call is about, and what `MakeChoice` selects it by. */
    source: string;
    /** The performance file it was aligned against, by name. Nothing reads it; a reader does. */
    midi: string;
    /** Which model ran, so the run can be repeated. */
    model: MlignModelId;
    /** Matches the model was less sure of than this were not written. */
    minConfidence: number;
    /**
     * What the reader decided about each divergence, by the id `divergencesOf` gives it.
     *
     * A `Map`, which `Work.ts`'s replacer and reviver carry across the round trip. The ids are
     * named after the notes they cover precisely so that they can be read back against a grouping
     * made fresh — see `divergenceId`.
     */
    resolutions: ReadonlyMap<string, Resolution>;
    /** Who decided, and how sure. Written into every `<when>` the decisions reach. */
    resp: string;
    certainty: string;
}

const readResolutions = (value: unknown): ReadonlyMap<string, Resolution> => {
    // A `Map` once the reviver has been through it, and a list of pairs in a file that lost the
    // envelope. Read rather than cast, as everything else here is.
    const entries: unknown[] =
        value instanceof Map ? [...value.entries()] : Array.isArray(value) ? value : [];

    return new Map(
        entries.flatMap((entry: unknown) => {
            if (!Array.isArray(entry) || entry.length !== 2) return [];
            const [id, resolution] = entry as [unknown, unknown];
            if (typeof id !== 'string') return [];
            if (typeof resolution !== 'object' || resolution === null) return [];

            const held = resolution as Record<string, unknown>;
            if (typeof held['reading'] !== 'string') return [];
            if (typeof held['action'] !== 'string') return [];
            return [[id, { reading: held['reading'], action: held['action'] as Action }]];
        }),
    );
};

const readAlignment = (options: Call['options']): WorkAlignment | null => {
    const source = options['source'];
    if (typeof source !== 'string' || !source) return null;

    return {
        source,
        midi: typeof options['midi'] === 'string' ? options['midi'] : '',
        model: typeof options['model'] === 'string' ? (options['model'] as MlignModelId) : 'v3',
        minConfidence:
            typeof options['minConfidence'] === 'number' ? options['minConfidence'] : 0,
        resolutions: readResolutions(options['resolutions']),
        resp: typeof options['resp'] === 'string' ? options['resp'] : '',
        certainty: typeof options['certainty'] === 'string' ? options['certainty'] : 'unknown',
    };
};

/**
 * Every take the document says was aligned, in the order the calls were made.
 *
 * A call naming no `@source` is dropped rather than repaired: it cannot say which `<recording>` it
 * is about, so there is nothing it can be read as.
 */
export const alignmentsOf = (work: WorkFile): WorkAlignment[] =>
    work.provenance
        .filter((call) => call.name === 'Align')
        .map((call) => readAlignment(call.options))
        .filter((alignment): alignment is WorkAlignment => alignment !== null);

/**
 * Does this call say anything about the performance?
 *
 * Two do not. `InsertMetadata` writes the document's `<metadata>` — who made this description, and
 * what they said about it — and no instruction, so counting it makes a reconstruction nobody has
 * started yet report a call it does not have. `ProcessVoices` says which MEI voice goes into which
 * MSM part, which is a statement about the *score's encoding*: a reconstruction that has done
 * nothing but sort its voices into parts has claimed nothing yet about how the piece was played.
 *
 * `Align` is the third, and the plainest: it says which sounding event realises which written
 * note, which is what a reconstruction reads *before* it has claimed anything about how the piece
 * was played.
 *
 * `Modify` and `MakeChoice` are not exceptions: correcting the recording and picking between
 * readings are statements about the performance, made by reshaping rather than by adding.
 *
 * **By name, and only for counting.** The narrative excludes a call that wrote no instruction by
 * its having no elements to show rather than by a list of transformer names (see
 * {@link Call.segment}), which is the better rule — it is derived, so it stays right for
 * transformers this build has never heard of. It cannot be used here: `elements` is recorded by a
 * run, a call made a moment ago has none yet, and "how much has been claimed so far" has to
 * answer before the fit comes back.
 */
const WRITES_NO_INSTRUCTION = new Set(['InsertMetadata', 'ProcessVoices', 'Align']);

export const describesPerformance = (call: Call): boolean => !WRITES_NO_INSTRUCTION.has(call.name);

/**
 * Apply one edit to the document.
 *
 * Returns the state it was given, by reference, for an edit that changes nothing.
 */
export const workReducer = (state: WorkFile, action: WorkAction): WorkFile => {
    switch (action.type) {
        case 'load':
            return action.work;

        case 'add-call': {
            // **A new call lands ungrouped.** Grouping is its own step, with its own desk, so a
            // call arrives with no `segment` and the narrative desk shows what it wrote in amber
            // until somebody says what it is for. Folding a new call into whichever claim happens
            // to overlap its range would be convenient, and would write claims nobody had made.
            //
            // Stripped here rather than trusted from the caller: the rule is the document's, and
            // a rule kept by whoever builds the action is a rule kept most of the time.
            return { ...state, provenance: [...state.provenance, ungrouped(action.call)] };
        }

        case 'remove-calls': {
            const dropping = new Set(action.ids);
            const provenance = state.provenance.filter((call) => !dropping.has(call.id));
            if (provenance.length === state.provenance.length) return state;

            // A claim nothing is made under any more is not a claim about the performance. The
            // segments hold no lists to prune — the calls named them — so this is the only place
            // the removal touches them at all.
            const standing = new Set(provenance.map((call) => call.segment));
            return {
                ...state,
                provenance,
                segments: state.segments.filter((segment) => standing.has(segment.id)),
            };
        }

        case 'group-calls': {
            // **One update rather than two**, because creating a segment and putting the first
            // calls under it is one act: done in two, the state in between holds a claim nothing
            // is made under, which `remove-calls` would be within its rights to sweep away.
            if (action.callIds.length === 0) return state;
            const moving = new Set(action.callIds);
            const { segment } = action;

            const provenance = state.provenance.map((call) => {
                if (!moving.has(call.id)) return call;
                if (!segment) return call.segment === undefined ? call : ungrouped(call);
                return call.segment === segment.id ? call : { ...call, segment: segment.id };
            });
            const segments =
                segment && !state.segments.some(({ id }) => id === segment.id)
                    ? [...state.segments, segment]
                    : state.segments;

            if (segments === state.segments && sameEntries(provenance, state.provenance))
                return state;
            return { ...state, provenance, segments };
        }

        case 'dissolve-segment': {
            // The calls survive and become unclaimed — the honest place for them. Deleting what
            // a withdrawn claim covered would delete the reconstruction, not the reading of it.
            const { segmentId } = action;
            const held = state.provenance.some((call) => call.segment === segmentId);
            const known = state.segments.some(({ id }) => id === segmentId);
            if (!held && !known) return state;

            return {
                ...state,
                provenance: state.provenance.map((call) =>
                    call.segment === segmentId ? ungrouped(call) : call,
                ),
                segments: state.segments.filter(({ id }) => id !== segmentId),
            };
        }

        case 'set-segments': {
            if (sameEntries(action.segments, state.segments)) return state;
            return { ...state, segments: action.segments };
        }

        case 'set-secondary': {
            const previous = state.secondary ?? NO_SECONDARY;
            const next =
                typeof action.update === 'function' ? action.update(previous) : action.update;
            if (next === previous) return state;
            return { ...state, secondary: next };
        }

        case 'set-metadata': {
            const existing = state.provenance.find((entry) => entry.name === 'InsertMetadata');
            const before = metadataOf(state);
            const after =
                typeof action.update === 'function' ? action.update(before) : action.update;
            // The metadata desk syncs on blur, so tabbing out of an untouched field arrives here
            // as an edit. Saying so — rather than writing an identical call — is what keeps the
            // undo stack from filling with steps that undo nothing.
            if (after.author === before.author && after.title === before.title) return state;

            // The existing options are spread first so that whatever has no UI survives being
            // edited through one: `InsertMetadata` also takes `relatedResources`, and rebuilding
            // its options from the two fields on screen is how a file quietly loses them.
            const options: Call['options'] = {
                ...existing?.options,
                authors: after.author ? [{ number: 0, text: after.author }] : [],
                comments: after.title ? [{ text: after.title }] : [],
            };
            // Likewise the rest of the call: an `InsertMetadata` may carry a segment and, after a
            // run, the elements it is answerable for. A metadata edit is not the moment to drop
            // either.
            const call: Call = existing
                ? { ...existing, options }
                : { id: action.newCallId, name: 'InsertMetadata', options };

            return {
                ...state,
                provenance: existing
                    ? state.provenance.map((entry) => (entry.id === call.id ? call : entry))
                    : [...state.provenance, call],
            };
        }

        case 'set-voices': {
            const existing = state.provenance.find((entry) => entry.name === 'ProcessVoices');
            const before = voicesOf(state);
            const after =
                typeof action.update === 'function' ? action.update(before) : action.update;

            // Compared by serializing, which this file warns against in general and which is sound
            // here in particular: a layout is numbers, names, voice keys and tick ranges — plain
            // JSON with no `Map` or `Set` in it, so `JSON.stringify` is a total and faithful
            // comparison. A no-op must return the state by reference, or every blur of an
            // untouched part name pushes a step onto the undo stack that undoes nothing.
            if (JSON.stringify(after) === JSON.stringify(before)) return state;
            // An empty layout says nothing, so there is nothing to write a call for.
            if (!existing && after.parts.length === 0 && after.moves.length === 0) return state;

            // Spread first, so an option with no UI survives being edited through one — the rule
            // the metadata case keeps for `relatedResources`.
            const options: Call['options'] = {
                ...existing?.options,
                parts: after.parts,
                moves: after.moves,
            };
            // Likewise the rest of the call: a `ProcessVoices` may carry a segment, and a rename is
            // not the moment to drop it.
            const call: Call = existing
                ? { ...existing, options }
                : { id: action.newCallId, name: 'ProcessVoices', options };

            return {
                ...state,
                provenance: existing
                    ? state.provenance.map((entry) => (entry.id === call.id ? call : entry))
                    : [...state.provenance, call],
            };
        }

        case 'set-alignment': {
            const { alignment } = action;
            // The call for *this* take. A document may hold several, so the name is what picks
            // one out — the same string that picks out the `<recording>` it is about.
            const existing = state.provenance.find(
                (entry) => entry.name === 'Align' && entry.options['source'] === alignment.source,
            );

            // Compared by serializing, as `set-voices` is. Sound for the same reason and one
            // more: `resolutions` is a `Map` of plain records, which `JSON.stringify` renders as
            // `{}` — so it is unwrapped here rather than trusted to compare itself.
            const flattened = { ...alignment, resolutions: [...alignment.resolutions] };
            const before = existing ? readAlignment(existing.options) : null;
            if (
                before &&
                JSON.stringify(flattened) ===
                    JSON.stringify({ ...before, resolutions: [...before.resolutions] })
            ) {
                return state;
            }

            // Spread first, so an option with no UI survives being edited through one — the rule
            // the two cases above keep.
            const options: Call['options'] = { ...existing?.options, ...alignment };
            const call: Call = existing
                ? { ...existing, options }
                : { id: action.newCallId, name: 'Align', options };

            return {
                ...state,
                provenance: existing
                    ? state.provenance.map((entry) => (entry.id === call.id ? call : entry))
                    : [...state.provenance, call],
            };
        }
    }
};

// ── undo and redo ─────────────────────────────────────────────────

/**
 * How far back Ctrl-Z reaches.
 *
 * A snapshot is a whole `WorkFile`, but only in the way a directory listing is a whole disk: the
 * calls and segments an edit did not touch are the same objects in both, so an entry costs one
 * spine — a couple of hundred pointers for the shipped reconstruction — rather than a copy of
 * the document. A hundred of those is nothing to hold and further back than anyone remembers
 * having edited, which is the real bound: undo past what you can still picture is a worse tool
 * than a saved file.
 */
export const MAX_HISTORY = 100;

export interface WorkHistory {
    past: WorkFile[];
    present: WorkFile;
    future: WorkFile[];
}

export type WorkHistoryAction = WorkAction | { type: 'undo' } | { type: 'redo' };

export const initialHistory = (work: WorkFile = EMPTY_WORK): WorkHistory => ({
    past: [],
    present: work,
    future: [],
});

export const canUndo = (state: WorkHistory): boolean => state.past.length > 0;
export const canRedo = (state: WorkHistory): boolean => state.future.length > 0;

/**
 * Step to a remembered document, keeping the desk bag that is on screen now.
 *
 * A snapshot carries the `secondary` it had at the time, and restoring that with it would make
 * undo move the tempo desk's boxes back — which nobody asked for, because they never went into
 * the history in the first place (see below). So the document steps and the bag does not.
 */
const withLiveSecondary = (restored: WorkFile, present: WorkFile): WorkFile => {
    if (restored.secondary === present.secondary) return restored;
    const next = { ...restored };
    if (present.secondary === undefined) delete next.secondary;
    else next.secondary = present.secondary;
    return next;
};

/** Push onto the past, keeping the most recent {@link MAX_HISTORY} entries. */
const remember = (past: readonly WorkFile[], present: WorkFile): WorkFile[] =>
    [...past, present].slice(-MAX_HISTORY);

/**
 * {@link workReducer}, with a past and a future either side of it.
 *
 * Three rules, and each is a decision:
 *
 * - **Opening a file resets the history.** The past belongs to the document that had it; undoing
 *   from a freshly opened file into edits made to a different one would be an offer to corrupt
 *   it. There is no undoing past the file you opened.
 * - **An edit that changed nothing is not a step.** `workReducer` says so by handing back the
 *   state it was given, which is exactly what a blur on an untouched field or a click on the
 *   claim a call is already under produces. Every one of those recorded would be a Ctrl-Z that
 *   appears to do nothing.
 * - **The desk bag is not in the history.** `secondary` is per-desk editorial working state —
 *   the skyline's boxes, hand-marked silent onsets, drawn trails — and it explicitly does not
 *   reach the fitting chain, so undoing it would change nothing anybody can hear. It is also
 *   written continuously while a box is dragged: recorded, it would push the edits somebody
 *   might actually want back out of a bounded history, several times per gesture. So it updates
 *   the present and leaves the past alone.
 */
export const workHistoryReducer = (
    state: WorkHistory,
    action: WorkHistoryAction,
): WorkHistory => {
    switch (action.type) {
        case 'undo': {
            const previous = state.past.at(-1);
            if (!previous) return state;
            return {
                past: state.past.slice(0, -1),
                present: withLiveSecondary(previous, state.present),
                future: [state.present, ...state.future],
            };
        }

        case 'redo': {
            const next = state.future.at(0);
            if (!next) return state;
            return {
                past: remember(state.past, state.present),
                present: withLiveSecondary(next, state.present),
                future: state.future.slice(1),
            };
        }

        case 'load':
            return initialHistory(workReducer(state.present, action));

        default: {
            const present = workReducer(state.present, action);
            if (present === state.present) return state;
            if (action.type === 'set-secondary') return { ...state, present };
            // A new edit is a new branch: whatever was undone away is not coming back.
            return { past: remember(state.past, state.present), present, future: [] };
        }
    }
};
