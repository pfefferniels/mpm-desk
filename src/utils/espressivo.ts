/**
 * The espressivo (meico-ts) facade — what the Java meico backend's `/perform` used to do.
 *
 * Pure and synchronous, which is why it is called from `espressivo.worker.ts` rather than
 * directly. The MEI conversion the backend also served happens at bake time now, in
 * `scripts/deriveSegments.ts`.
 */
import {
    renderExpressiveMidi,
    exaggerateMpm,
    spotlightMpm,
    weightedFactors,
} from 'espressivo';

export interface RenderRequest {
    /** The score as MSM XML, i.e. `public/score.msm`. */
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

/**
 * MSM + MPM ⇒ expressive MIDI. Replaces the backend's `/perform`.
 *
 * The MIDI carries one text meta event per note-on holding the note's `xml:id`, on a grid
 * where one tick is one millisecond — the two properties playback depends on.
 */
export const renderPerformance = (request: RenderRequest): Uint8Array => {
    const { msm, exaggerate, sketchiness, mpmIds, isolate } = request;
    let mpm = request.mpm;

    // Every id a segment names is an instruction espressivo can map onto a dimension;
    // scripts/verifySegments.ts spotlights each segment against this very MPM to prove it.
    if (mpmIds?.length) {
        mpm = spotlightMpm(mpm, {
            ids: mpmIds,
            attenuation: isolate ? ISOLATE_ATTENUATION : SPOTLIGHT_ATTENUATION,
        }).mpm;
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
