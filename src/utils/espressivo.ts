/**
 * The espressivo (meico-ts) facade — everything the Java meico backend used to do.
 *
 * `/convert` became {@link convertMei} and `/perform` became {@link renderPerformance}.
 * Both are pure, synchronous and run in the browser, which is why they are called from
 * `espressivo.worker.ts` rather than directly: a conversion takes several seconds.
 */
import {
    convertMeiToMsmMpm,
    renderExpressiveMidi,
    exaggerateMpm,
    spotlightMpm,
    weightedFactors,
} from 'espressivo';

interface ConvertedMovement {
    /** The score as MSM XML — what `asMSM` reads, and what a render performs. */
    msm: string;
    /** The MPM the conversion derives from the MEI. Unused so far: the app builds its own. */
    mpm: string;
}

/**
 * MEI ⇒ MSM. Replaces the backend's `/convert`.
 *
 * Only the first movement is used, matching the Java service's `movementIndex` default of 0.
 * Attribute values are formatted differently from meico's (`720` where Java wrote `720.0`),
 * which every reader here parses through `Number()` — see scripts/compareConvert.
 */
export const convertMei = (mei: string): ConvertedMovement => {
    const movements = convertMeiToMsmMpm(mei);
    if (!movements.length) throw new Error('MEI holds no convertible movement');
    const { msm, mpm } = movements[0];
    return { msm, mpm };
};

export interface RenderRequest {
    /** The score, as returned by {@link convertMei}. */
    msm: string;
    /** The performance to render, as MPM XML. */
    mpm: string;
    /** Overall exaggeration; 1 is neutral. Multiplied with `sketchiness`. */
    exaggerate?: number;
    /** How loose the rendering is; 1 is neutral. Multiplied with `exaggerate`. */
    sketchiness?: number;
    /** Instruction ids to bring forward by damping everything else. */
    mpmIds?: string[];
    /** With `mpmIds`, how hard to damp the rest. */
    isolate?: boolean;
}

/**
 * The ceiling on the expression scalar.
 *
 * espressivo's default is no weighting — every dimension takes the scalar as it comes — and
 * that is what this uses. It needs one number on top: a ceiling. `ornamentSpread` carries
 * espressivo's `p5r: 'cliff'` verdict on every row, and because tick-framed ornaments resolve
 * symbolically (PARITY.md D5) a widened spread lands on notes that tempo then stretches. On
 * this pipeline's MPM the scalar sweep is smooth to within 1% per step up to 1.90, jumps 51%
 * at 1.95, and reaches 980 s at 2.15. `scripts/verifyEspressivo.ts` re-measures it.
 *
 * (espressivo also ships `PROTOTYPE_WEIGHTS`, the Java prototype's profile, but its own
 * documentation calls it a heuristic rather than a recommendation — and it weights
 * `ornamentSpread` 1.5, which puts a slider maximum of 2 well past the cliff.)
 */
const EXPRESSION_MAX = 1.9;

/** How hard non-selected material is damped, with and without `isolate`. */
const SPOTLIGHT_ATTENUATION = 0.35;
const ISOLATE_ATTENUATION = 0.05;

/** Element types `spotlightMpm` can map onto an exaggeration dimension. */
const SPOTLIGHTABLE = new Set([
    'tempo', 'dynamics', 'rubato', 'articulation',
    'accentuationPattern', 'ornament', 'asynchrony', 'movement',
    'distribution.uniform', 'distribution.gaussian',
    'distribution.triangular', 'distribution.correlated.brownianNoise',
    'distribution.correlated.compensatingTriangle', 'distribution.list',
]);

/**
 * Narrow a set of instruction ids to what `spotlightMpm` accepts.
 *
 * The app selects whatever a transformer created, which includes `<accentuation>` entries.
 * Those sit inside an `<accentuationPatternDef>` in the header and govern no dimension of
 * their own, so espressivo rejects them — and it rejects all-or-nothing, so one such id
 * would abort the whole render. Each is replaced by the `<accentuationPattern>` instructions
 * that reference its def, which is the same musical material seen from the dated environment.
 */
export const resolveSpotlightIds = (mpmXml: string, ids: string[]): string[] => {
    const doc = new DOMParser().parseFromString(mpmXml, 'application/xml');

    // Indexed by hand rather than by selector: an xml:id is not guaranteed to be a valid CSS
    // identifier, and the `name.ref` attribute would need escaping of its dot as well.
    const byId = new Map<string, Element>();
    const patternsByDef = new Map<string, string[]>();
    for (const element of Array.from(doc.getElementsByTagName('*'))) {
        const id = element.getAttribute('xml:id');
        if (id) byId.set(id, element);

        if (element.tagName === 'accentuationPattern' && id) {
            const ref = element.getAttribute('name.ref');
            if (ref) patternsByDef.set(ref, [...(patternsByDef.get(ref) ?? []), id]);
        }
    }

    const resolved = new Set<string>();
    for (const id of ids) {
        const element = byId.get(id);
        if (!element) continue;

        if (SPOTLIGHTABLE.has(element.tagName)) {
            resolved.add(id);
            continue;
        }

        if (element.tagName === 'accentuation') {
            const def = element.closest('accentuationPatternDef')?.getAttribute('name');
            for (const patternId of (def ? patternsByDef.get(def) ?? [] : [])) resolved.add(patternId);
        }
    }

    return Array.from(resolved);
};

/**
 * MSM + MPM ⇒ expressive MIDI. Replaces the backend's `/perform`.
 *
 * The MIDI carries one text meta event per note-on holding the note's `xml:id`, on a grid
 * where one tick is one millisecond — the two properties playback depends on.
 */
export const renderPerformance = (request: RenderRequest): Uint8Array => {
    const { msm, exaggerate, sketchiness, mpmIds, isolate } = request;
    let mpm = request.mpm;

    if (mpmIds?.length) {
        const ids = resolveSpotlightIds(mpm, mpmIds);
        // An empty selection would mean "spotlight nothing", which espressivo reads as the
        // identity — so skipping the call and skipping the transform agree.
        if (ids.length) {
            mpm = spotlightMpm(mpm, {
                ids,
                attenuation: isolate ? ISOLATE_ATTENUATION : SPOTLIGHT_ATTENUATION,
            }).mpm;
        }
    }

    // One scalar, one call. Two `exaggerateMpm` calls would not compose: each scales the level
    // dimensions around a center it computes from the document it is given, so the second
    // recomputes that center from the already transformed one and the effects compound.
    const scalar = Math.min(EXPRESSION_MAX, (exaggerate ?? 1) * (sketchiness ?? 1));
    if (scalar !== 1) {
        mpm = exaggerateMpm(mpm, { factors: weightedFactors(scalar, {}) }).mpm;
    }

    return renderExpressiveMidi({ msm, mpm });
};
