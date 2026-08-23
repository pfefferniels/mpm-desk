/**
 * The espressivo (meico-ts) facade — what the Java meico backend's `/perform` used to do.
 *
 * Pure and synchronous, and called as such: rendering this piece takes ~36 ms, ~53 ms with a
 * spotlight, so playback pays a few frames at the click rather than a worker boundary. It used
 * to run in `espressivo.worker.ts`, back when the same render took ~170 ms.
 *
 * The MEI conversion the backend also served happens at bake time now, in
 * `scripts/deriveSegments.ts`.
 */
import { read, type MidiFile } from 'midifile-ts';
import { addAbsoluteTime, type AbsoluteEvent } from 'react-pianosound';
import {
    renderExpressiveMidi,
    exaggerateMpm,
    spotlightMpm,
    weightedFactors,
} from 'espressivo';
import { indexNoteIds } from './anchor';

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
export const EXPRESSION_MAX = 1.9;

/** The exaggeration slider's own range. `1` is neutral. */
export const EXAGGERATION_MAX = 2.0;

/**
 * Slider and zoom, combined into the one scalar `exaggerateMpm` takes.
 *
 * Multiplying the two and clamping the product is what the ceiling used to do, and it spent the
 * slider's headroom on the zoom: at `sketchiness` 1.5 the product reached the ceiling at
 * `exaggerate` 1.27, so the top two thirds of the slider travel rendered identically while the
 * intensity curve kept saturating. Zoom sets the floor instead, and the slider spends whatever
 * headroom is left — monotone in both, never clamped, and the whole travel audible at every zoom.
 *
 * `t` is the slider's own normalised travel, the same number `SegmentStack` colours segments by,
 * so the curve and the sound now saturate together.
 */
export const effectiveScalar = (exaggerate = 1, sketchiness = 1): number => {
    const floor = Math.min(sketchiness, EXPRESSION_MAX);
    const t = Math.min(1, Math.max(0, (exaggerate - 1) / (EXAGGERATION_MAX - 1)));
    return floor + t * (EXPRESSION_MAX - floor);
};

/** How hard non-selected material is damped, with and without `isolate`. */
const SPOTLIGHT_ATTENUATION = 0.35;
const ISOLATE_ATTENUATION = 0.05;

/**
 * MSM + MPM ⇒ expressive MIDI. Replaces the backend's `/perform`.
 *
 * The MIDI carries one text meta event per note-on holding the note's `xml:id`, on a grid
 * where one tick is one millisecond — the two properties playback depends on.
 */
const spotlightKey = (mpm: string, ids: readonly string[], isolate: boolean | undefined) =>
    `${mpm.length}|${isolate ? 1 : 0}|${ids.join(',')}`;

/**
 * Spotlighting costs ~9 ms and does not depend on the exaggeration scalar, so a segment preview
 * pays for it once however far the slider then travels.
 */
let spotlightCache: { source: string; key: string; mpm: string } | null = null;

const spotlit = (mpm: string, ids: readonly string[], isolate: boolean | undefined): string => {
    const key = spotlightKey(mpm, ids, isolate);
    if (spotlightCache?.source === mpm && spotlightCache.key === key) return spotlightCache.mpm;
    const result = spotlightMpm(mpm, {
        ids: [...ids],
        attenuation: isolate ? ISOLATE_ATTENUATION : SPOTLIGHT_ATTENUATION,
    }).mpm;
    spotlightCache = { source: mpm, key, mpm: result };
    return result;
};

const renderAtScalar = (
    msm: string,
    performanceMpm: string,
    scalar: number,
    mpmIds: readonly string[] | undefined,
    isolate: boolean | undefined,
): Uint8Array => {
    let mpm = performanceMpm;

    // Every id a segment names is an instruction espressivo can map onto a dimension;
    // scripts/verifySegments.ts spotlights each segment against this very MPM to prove it.
    if (mpmIds?.length) mpm = spotlit(mpm, mpmIds, isolate);

    // One scalar, one call. Two `exaggerateMpm` calls would not compose: each scales the level
    // dimensions around a center it computes from the document it is given, so the second
    // recomputes that center from the already transformed one and the effects compound.
    if (scalar !== 1) {
        mpm = exaggerateMpm(mpm, { factors: weightedFactors(scalar, {}) }).mpm;
    }

    return renderExpressiveMidi({ msm, mpm });
};

export const renderPerformance = (request: RenderRequest): Uint8Array => {
    const { msm, mpm, exaggerate, sketchiness, mpmIds, isolate } = request;
    return renderAtScalar(msm, mpm, effectiveScalar(exaggerate, sketchiness), mpmIds, isolate);
};

/** A rendering, and everything playback needs to install or splice it. */
export interface Rendered {
    file: MidiFile;
    /** Flattened and absolute-timed, in the very time base `react-pianosound` schedules from. */
    events: AbsoluteEvent[];
    /** Note `xml:id` ⇒ absolute ms, for anchoring this rendering against another. */
    noteIds: Map<string, number>;
    /** The scalar this was actually rendered at, after quantization. */
    scalar: number;
}

/**
 * A slider drag revisits values constantly, and rendering is deterministic — this MPM carries no
 * imprecision map and espressivo uses no RNG — so the same scalar always yields the same bytes.
 *
 * Quantizing the key matters as much as the cache: `computeSketchiness` is continuous in the zoom,
 * so an unrounded scalar would mint a fresh entry per pixel of zoom and never hit. A hundredth of
 * a scalar is far below audible.
 */
const CACHE_LIMIT = 16;
const renderCache = new Map<string, Rendered>();
let cacheSource = '';

const quantize = (scalar: number) => Math.round(scalar * 100) / 100;

export const renderCached = (request: RenderRequest): Rendered => {
    const { msm, mpm, exaggerate, sketchiness, mpmIds, isolate } = request;

    // Keyed on what the render depends on, never on the documents themselves — they are megabytes
    // and they only change when a different work is loaded, which drops the cache wholesale.
    const source = `${msm.length}:${mpm.length}`;
    if (source !== cacheSource) {
        renderCache.clear();
        spotlightCache = null;
        cacheSource = source;
    }

    const scalar = quantize(effectiveScalar(exaggerate, sketchiness));
    const key = `${scalar}|${isolate ? 1 : 0}|${mpmIds?.join(',') ?? ''}`;

    const hit = renderCache.get(key);
    if (hit) {
        // Map iterates in insertion order, so re-inserting is the whole of the LRU.
        renderCache.delete(key);
        renderCache.set(key, hit);
        return hit;
    }

    const file = read(renderAtScalar(msm, mpm, scalar, mpmIds, isolate));
    const events = addAbsoluteTime(file);
    const rendered: Rendered = { file, events, noteIds: indexNoteIds(events), scalar };

    renderCache.set(key, rendered);
    if (renderCache.size > CACHE_LIMIT) {
        renderCache.delete(renderCache.keys().next().value!);
    }
    return rendered;
};
