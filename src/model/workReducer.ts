/**
 * Every edit a work file can undergo, as one pure function, and undo/redo over it.
 *
 * The rules hold *between* the two arrays: a call names the claim it is made under and a claim
 * exists because calls are made under it, so removing a call can retire a segment, and creating
 * a segment is meaningless until a call points at it. Keeping them here leaves nowhere else to
 * write them. What stays in the component is what is not the document: the open desk, the lit
 * calls, the zoom, the snackbar.
 *
 * Pure throughout: no `crypto.randomUUID()`, no `Date.now()`, no mutation of the state or of
 * anything reachable from it. A fresh id arrives in the action (see {@link WorkAction}
 * `set-metadata`), because {@link workHistoryReducer} asks the same question twice and needs the
 * same answer.
 *
 * An edit that changes nothing returns the state it was given, **by reference**. That is how
 * {@link workHistoryReducer} tells a real edit from a dead one: `options` holds `Map`s and `Set`s
 * (see {@link Call}), so no cheap deep-equal compares two work files honestly.
 */

import type { Call, Segment, WorkFile } from './Work';
import type {
    PartLayout,
    VoiceMove,
    VoiceSelection,
} from '../fitting/transformers/voices/ProcessVoices';
import type { Action, Resolution } from '../alignment/readings';
import { isRecordedModelId, type RecordedModelId } from '../alignment/mlign/models';

/** The empty document the editor starts on, before a file is opened. */
export const EMPTY_WORK: WorkFile = { name: '', mei: '', mpm: '', provenance: [], segments: [] };

/**
 * The desk bag, as much of it as this file is allowed to know.
 *
 * Stays `Record<string, unknown>`: the shape belongs to the desks, and importing it would point
 * the document at the desks that edit it. The reducer carries the bag and never opens it.
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
     * Title and author. The write half of the pair at {@link metadataOf}, which records why they
     * travel on the chain rather than beside it.
     *
     * `newCallId` is used only when the chain carries no such call yet, and arrives in the action
     * so that this stays a function of its arguments.
     */
    | { type: 'set-metadata'; update: MetadataUpdate; newCallId: string }
    /**
     * The voice layout, edited in place on the one `ProcessVoices` call.
     *
     * A layout is a *state*. A call per combine would make undo mean "take back one click"
     * rather than "go back to the layout before", and would leave the part numbers every other
     * call names as an emergent property of the whole sequence.
     *
     * `newCallId` arrives in the action, as `set-metadata`'s does.
     */
    | { type: 'set-voices'; update: VoicesUpdate; newCallId: string }
    /**
     * What was decided about one take, on the one `Align` call that names its `@source`.
     *
     * A whole value rather than an updater: the desk holds the review it is conducting, so it
     * always knows the alignment it means. `newCallId` arrives in the action, as above.
     */
    | { type: 'set-alignment'; alignment: WorkAlignment; newCallId: string };

/**
 * A call with its `segment` taken off.
 *
 * Deleted rather than set to `undefined`. Both write the same file, since `JSON.stringify` drops
 * an undefined value, but only one of them says so in a debugger.
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

// The title and author travel on the chain, as the options of the one `InsertMetadata` call:
// the runner builds `<metadata>` out of whatever call it carries, so a copy held beside the
// document would show in the app bar and be missing from the MPM.
//
// Reader and writer are written next to each other because they must agree about a shape
// neither owns. `options` is `Record<string, unknown>`, so looking for the title anywhere but
// where the writer puts it loses it on the round trip with nothing failing.

/**
 * The first `text` in what should be a list of `{ text }`. Anything else reads as "nothing said".
 *
 * Read rather than cast: `options` is whatever a file happened to contain.
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

// The layout travels on the one `ProcessVoices` call, on the same terms as the title above.

/**
 * What the voices desk edits: the layout, as parts and the moves that override it.
 *
 * Typed in `ProcessVoices`'s own vocabulary rather than in a second shape free to drift from it.
 * `exportWork` reaches for `MakeChoiceOptions` the same way.
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
 * A move's selector, validated into one of the two forms the transformer acts on, so that one it
 * could not use is dropped at the boundary instead of silently matching nothing later.
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
 * Read structurally rather than cast, as {@link firstText} is. The *first* such call wins and a
 * file holding two is left holding two, as with metadata.
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
 * A part nobody named is left out, so it keeps the `part<index>` `Alignment.build` writes.
 */
export const partNamesOf = (work: WorkFile): Map<number, string> => {
    const names = new Map<number, string>();
    for (const part of voicesOf(work).parts) {
        if (part.name) names.set(part.number, part.name);
    }
    return names;
};

// The alignment is the one of the three that is *not* a transformer call. `applyAlignment`
// writes the reader's decisions into the MEI, and the chain runs over that MEI, so by the time
// there is an `Alignment` to fit there is nothing left for a `transform` to do. `chain.ts` says
// so in a list rather than in an empty transformer.
//
// One thing does not survive the MEI, which is why this is recorded at all: an {@link Action}.
// A `<when>` carries the reading, the responsibility and the certainty, and nothing there says
// what was to be *done* about it. That is kept here, beside the settings the run was made with,
// so the run can be made again.
//
// One call per take, unlike the two above: a score may be aligned against several performances.

/** What the alignment desk records about one take. */
export interface WorkAlignment {
    /** The `<recording @source>` this call is about, and what `MakeChoice` selects it by. */
    source: string;
    /** The performance file it was aligned against, by name. Nothing reads it; a reader does. */
    midi: string;
    /** Which model ran. A fact about the past: it survives the model retiring. */
    model: RecordedModelId;
    /** Matches the model was less sure of than this were not written. */
    minConfidence: number;
    /**
     * What the reader decided about each divergence, by the id `divergencesOf` gives it.
     *
     * A `Map`, which `Work.ts`'s replacer and reviver carry across the round trip. The ids name
     * the notes they cover so they can be read back against a fresh grouping; see `divergenceId`.
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
        // Kept as recorded, including v1-v3, whose weights no longer ship —
        // `runnableModel` decides what a RE-run uses, and only at that moment.
        model: isRecordedModelId(options['model']) ? options['model'] : 'v4',
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
 * These three do not. `InsertMetadata` writes `<metadata>` and no instruction. `ProcessVoices`
 * says which MEI voice goes into which MSM part, a statement about the score's encoding. `Align`
 * says which sounding event realises which written note, which a reconstruction reads before it
 * has claimed anything. `Modify` and `MakeChoice` are not exceptions: reshaping the performance
 * is still a statement about it.
 *
 * **By name, and only for counting.** The narrative uses the better rule, a call having no
 * elements to show (see {@link Call.segment}), which stays right for transformers this build has
 * never heard of. That rule cannot be used here: `elements` is recorded by a run, so a call made
 * a moment ago has none, and this has to answer before the fit comes back.
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
            // **A new call lands ungrouped.** Grouping is its own step with its own desk, so the
            // narrative desk shows what a new call wrote in amber until somebody says what it is
            // for. Folding it into whichever claim overlaps its range would write claims nobody
            // made. Stripped here rather than trusted from the caller: the rule is the
            // document's.
            return { ...state, provenance: [...state.provenance, ungrouped(action.call)] };
        }

        case 'remove-calls': {
            const dropping = new Set(action.ids);
            const provenance = state.provenance.filter((call) => !dropping.has(call.id));
            if (provenance.length === state.provenance.length) return state;

            // A claim nothing is made under any more is not a claim. The segments hold no lists
            // to prune, since the calls named them, so this is the only place removal reaches
            // them.
            const standing = new Set(provenance.map((call) => call.segment));
            return {
                ...state,
                provenance,
                segments: state.segments.filter((segment) => standing.has(segment.id)),
            };
        }

        case 'group-calls': {
            // **One update rather than two**: done in two, the state in between holds a claim
            // nothing is made under, which `remove-calls` would be within its rights to sweep
            // away.
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
            // as an edit. Returning by reference keeps the undo stack free of steps that undo
            // nothing.
            if (after.author === before.author && after.title === before.title) return state;

            // Spread first so that whatever has no UI survives being edited through one:
            // `InsertMetadata` also takes `relatedResources`, and rebuilding its options from the
            // two fields on screen would drop them.
            const options: Call['options'] = {
                ...existing?.options,
                authors: after.author ? [{ number: 0, text: after.author }] : [],
                comments: after.title ? [{ text: after.title }] : [],
            };
            // Likewise the rest of the call: an `InsertMetadata` may carry a segment and, after a
            // run, the elements it is answerable for.
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

            // Compared by serializing, which is sound here though not in general: a layout is
            // numbers, names, voice keys and tick ranges, plain JSON with no `Map` or `Set` in
            // it. A no-op must return the state by reference, or every blur of an untouched part
            // name pushes a step onto the undo stack that undoes nothing.
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

            // Compared by serializing, as `set-voices` is. `resolutions` is a `Map` of plain
            // records, which `JSON.stringify` renders as `{}`, so it is unwrapped first.
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

/**
 * How far back Ctrl-Z reaches.
 *
 * A snapshot is a whole `WorkFile`, but the calls and segments an edit did not touch are shared
 * between entries, so one costs a spine of a couple of hundred pointers rather than a copy of
 * the document. A hundred of those is further back than anyone remembers having edited.
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
