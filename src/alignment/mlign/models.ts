/**
 * Which checkpoints there are, and where they sit.
 *
 * Its own module, and importing nothing, on purpose: `index.ts` needs to name a
 * model without dragging `session.ts` — and with it the whole onnxruntime-web
 * bundle — into the route's first chunk. That is also why the *mode* a model
 * runs in is not recorded here. A file name is not evidence about weights: which
 * attribution head a checkpoint carries is read off the loaded graph's own
 * outputs, in `session.ts`.
 */

/** Which checkpoint to align with. Every one of them is shipped in `public/`. */
export type MlignModelId = "v1" | "v2" | "v3";

/**
 * The checkpoints, newest first, as shipped in `public/`. Fetched at run time,
 * never imported.
 *
 * They differ in the ornament-attribution head and in nothing else a host can
 * see: the alignment outputs have the same names, shapes and meaning in all
 * three, so an older file still aligns exactly as it did.
 */
export const MLIGN_MODELS: Record<
    MlignModelId,
    { file: string; label: string; note: string }
> = {
    v3: {
        file: "mlign-v3-fp16.onnx",
        label: "v3",
        note:
            "Attribution conditioned on the match head, so that whether a played " +
            "note is an ornament at all is answered by the alignment rather than " +
            "guessed again.",
    },
    v2: {
        file: "mlign-v2-fp16.onnx",
        label: "v2",
        note: "The first model with an attribution head, read as a raw softmax.",
    },
    v1: {
        file: "mlign-v1-fp16.onnx",
        label: "v1",
        note: "Alignment only — it cannot be asked what a played note ornaments.",
    },
};

/** The model an alignment uses unless the caller names another. */
export const DEFAULT_MODEL: MlignModelId = "v3";

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
