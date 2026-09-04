/**
 * Which checkpoints there are, and where they sit.
 *
 * Its own module, importing nothing, so `index.ts` can name a model without
 * dragging `session.ts` and the whole onnxruntime-web bundle into the route's
 * first chunk. Which *mode* a model runs in is likewise not recorded here: a
 * file name is not evidence about weights, so `session.ts` reads the attribution
 * head off the loaded graph's own outputs.
 *
 * Only v4 ships. v1 to v3 are dominated: on the 740 ornament figures of
 * Batik-plays-Mozart carrying ground truth, v4 attributes .4784 entirely
 * correctly against v3's .3297, paired over the same figures, while tying v3 and
 * v2 on every alignment measure (match, insertion and deletion F, p = .95, .95,
 * .74 against v3). Three superseded checkpoints would cost ~9.7 MB of download
 * to offer a worse answer.
 *
 * Reading a document written by an older model needs no model at all. Only
 * re-aligning does, and that is what v4 is for.
 */

/** Which checkpoint to align with — the ones whose weights ship. */
export type MlignModelId = "v4";

/**
 * What a document may say ran, which is not the same set.
 *
 * A provenance chain records a fact about the past, so reading one must return
 * what it says even when those weights are gone. Coercing `v3` to `v4` on the
 * way in would not make the older run reproducible, it would only lose the
 * record that it happened.
 */
export type RecordedModelId = MlignModelId | "v1" | "v2" | "v3";

/**
 * The checkpoints, as shipped in `public/`. Fetched at run time, never imported.
 */
export const MLIGN_MODELS: Record<MlignModelId, { file: string; note: string }> = {
    v4: {
        file: "mlign-v4-fp16.onnx",
        note:
            "Attribution conditioned on the match head, trained on trills that " +
            "move at the speed real ones do and that re-strike their principal " +
            "the way real ones do — which is what the head had never been shown.",
    },
};

/** The model an alignment uses unless the caller names another. */
export const DEFAULT_MODEL: MlignModelId = "v4";

const RECORDED: readonly string[] = ["v1", "v2", "v3", "v4"];

/** Whether a stored value names a model this build knows of, shipped or not. */
export function isRecordedModelId(value: unknown): value is RecordedModelId {
    return typeof value === "string" && RECORDED.includes(value);
}

/**
 * The model to actually run for a recorded one.
 *
 * Documents written before 2026-08-30 name v1, v2 or v3, whose weights no longer
 * ship. Such a document re-aligns with v4, which is a better answer than the one
 * it recorded and the only one available. What it recorded is untouched.
 */
export function runnableModel(recorded: RecordedModelId | undefined): MlignModelId {
    return recorded !== undefined && recorded in MLIGN_MODELS
        ? (recorded as MlignModelId)
        : DEFAULT_MODEL;
}

/** Where a given checkpoint sits, as a URL the browser can fetch. */
export function modelUrl(model: MlignModelId = DEFAULT_MODEL): string {
    // `BASE_URL` rather than a leading-slash literal, so a sub-path deploy
    // resolves correctly — the same thing `Viewer.tsx` does for
    // `transcription.mei`.
    const base = import.meta.env?.BASE_URL ?? "/";
    return `${base}${MLIGN_MODELS[model].file}`;
}

/** Where the model sits by default. */
export function defaultModelUrl(): string {
    return modelUrl(DEFAULT_MODEL);
}
