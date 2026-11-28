/**
 * A call as a remark states it, made into the call a desk would have made.
 *
 * A desk never hands over a call without a scope, a name or its tolerances; a reader, or the
 * model reading for one, does. What a desk always writes is filled in here, and what could not
 * run is said, so that the step is reported and not the chain broken.
 */
import type { Call } from '../../model/Work';

/** The tolerances `StylizeOrnamentation` gets where none are stated. */
export const STYLIZE = { tickTolerance: 8, intensityTolerance: 0.3, gradientTolerance: 0.1 };

const NOT_FOR_A_READER = new Map<string, string>([
    ['Describe', 'a remark is not a step of a remark'],
    ['AlignSource', 'the recording is already aligned'],
    ['InsertMetadata', 'title and author are set on their own desk'],
    ['MakeChoice', 'the take that is read is chosen on its own desk'],
    ['ProcessVoices', 'the parts are laid out on their own desk'],
    ['TranslatePhysicalTimeToTicks', 'the chain makes this call itself'],
    ['RoundNumbers', 'the chain makes this call itself'],
    ['AssumeTempo', 'the run makes this assumption itself'],
    ['AssumeLevel', 'the run makes this assumption itself'],
]);

/** Why a remark does not make a call of this name, or `undefined` where it may. */
export const refusal = (name: string): string | undefined => {
    const reason = NOT_FOR_A_READER.get(name);
    return reason === undefined
        ? undefined
        : `${name} is not a call a description makes: ${reason}`;
};

/** Transformers whose `scope` is `'global'` where none is stated. */
const SCOPED = new Set([
    'Modify',
    'InsertDynamicsGradient',
    'InsertTemporalSpread',
    'InsertTempo',
    'FitTempo',
    'InsertRubato',
    'CombineAdjacentRubatos',
    'InsertDynamics',
    'FitDynamics',
    'InsertMetricalAccentuation',
    'MergeMetricalAccentuations',
    'InsertArticulation',
    'MakeDefaultArticulation',
]);

/** Global scope only: a part's own map would hide the global one. */
const BOTH_HANDS = new Set([
    'InsertTempo',
    'FitTempo',
    'InsertRubato',
    'CombineAdjacentRubatos',
    'InsertDynamics',
    'FitDynamics',
    'InsertMetricalAccentuation',
    'MergeMetricalAccentuations',
]);

/** Options that have to be finite numbers. */
const NUMBERS: Record<string, string[]> = {
    InsertTempo: ['from', 'to', 'bpm', 'beatLength'],
    FitTempo: ['from', 'to', 'beatLength'],
    InsertRubato: ['date', 'length'],
    InsertDynamics: ['from', 'to'],
    FitDynamics: ['from', 'to'],
    InsertMetricalAccentuation: ['from', 'to', 'beatLength', 'scaleTolerance'],
    StylizeOrnamentation: ['tickTolerance', 'intensityTolerance', 'gradientTolerance'],
    CombineAdjacentRubatos: ['intensityTolerance', 'compressionTolerance'],
};

/** A `Map` keyed by date, from what a step states one as: a `Map`, pairs, or a plain object. */
const asMap = (value: unknown): Map<unknown, unknown> => {
    if (value instanceof Map) return value;
    if (Array.isArray(value))
        return new Map(value.filter((pair): pair is [unknown, unknown] => Array.isArray(pair)));
    if (value === null || typeof value !== 'object') return new Map();
    return new Map(
        Object.entries(value)
            .map(([key, entry]): [number, unknown] => [Number(key), entry])
            .filter(([date]) => Number.isFinite(date)),
    );
};

const asSet = (value: unknown): Set<unknown> => {
    if (value instanceof Set) return value;
    return new Set(Array.isArray(value) ? value : []);
};

/** The call with what a desk always writes filled in, or why it cannot run. */
export const complete = (call: Call): Call | string => {
    const options: Record<string, unknown> = { ...call.options };
    const { name } = call;

    if (SCOPED.has(name)) options['scope'] ??= 'global';
    if (BOTH_HANDS.has(name) && options['scope'] !== 'global') {
        return `${name} is written for both hands here: scope "global"`;
    }

    switch (name) {
        case 'InsertTemporalSpread':
            if (!('group' in options) && !('graces' in options)) {
                options['placement'] ??= 'estimate';
                options['noteOffShiftTolerance'] ??= 2;
            }
            break;
        case 'InsertDynamicsGradient':
            options['sortVelocities'] ??= true;
            break;
        case 'InsertDynamics':
            options['guides'] = asMap(options['guides']);
            break;
        case 'InsertPedal':
            if ('guides' in options) options['guides'] = asMap(options['guides']);
            break;
        case 'InsertMetricalAccentuation':
            options['name'] ??= `pattern-${call.id}`;
            options['scaleTolerance'] ??= 0;
            options['neutralEnd'] ??= true;
            break;
        case 'InsertArticulation':
            options['name'] ??= `articulation-${call.id}`;
            options['aspects'] = asSet(options['aspects'] ?? ['relativeDuration']);
            if (!Array.isArray(options['noteIDs']) || options['noteIDs'].length === 0) {
                return 'InsertArticulation needs the ids of its notes in "noteIDs"';
            }
            break;
        case 'FitTempo':
            options['beatLength'] ??= 0.25;
            options['shape'] ??= 'steady';
            break;
        case 'StylizeOrnamentation':
            for (const [key, value] of Object.entries(STYLIZE)) options[key] ??= value;
            break;
        case 'CombineAdjacentRubatos':
            options['intensityTolerance'] ??= 0.2;
            options['compressionTolerance'] ??= 0.2;
            break;
        case 'Modify':
            if (!['velocity', 'onset', 'duration'].includes(options['aspect'] as string)) {
                return 'Modify needs an "aspect": "velocity", "onset" or "duration"';
            }
            if (typeof options['change'] !== 'number' && !Array.isArray(options['points'])) {
                return 'Modify needs a "change" (a number) or "points"';
            }
            break;
    }

    for (const key of NUMBERS[name] ?? []) {
        if (typeof options[key] !== 'number' || !Number.isFinite(options[key])) {
            return `${name} needs a number for "${key}"`;
        }
    }
    return { ...call, options };
};
