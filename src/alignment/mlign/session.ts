/**
 * The MLign encoder running under onnxruntime-web.
 *
 * The exported graph is encoder-only: it stops at `s` / `p` / `match_s` /
 * `match_p` / `scale` and leaves the bilinear match head to the host, which is
 * `accumulate.ts`. This module is only responsible for getting the weights into
 * the browser and turning one window's feeds into those tensors.
 *
 * The ornament-attribution head is exported the same way and on the same terms —
 * `attr_s` / `attr_p` per token plus two constants, and the dot products left to
 * the host — but it is asked for rather than always returned: its two per-token
 * tensors are as large as `s` and `p` together.
 *
 * The contract is the `.onnx.json` sidecar beside each model file; the shapes
 * below are `mlign-v3-fp16.onnx.json`'s `graph` block, which extends v2's by one
 * output rather than changing any of it.
 *
 * Nothing here touches the DOM, so the whole module can be moved behind a Web
 * Worker later without changing anything but the caller.
 */

import { defaultModelUrl } from "./models";
import type { AttrConditioned } from "./types";
import * as ort from "onnxruntime-web/wasm";
// The package exports the binary at this root-level subpath. The `dist/` path
// that most write-ups show is *not* exported and is a hard build error under
// Vite 8. `?url` makes Vite emit the binary as a hashed asset and rewrite the
// specifier with the configured `base`, which is what lets the app deploy under
// a GitHub Pages sub-path with no further configuration.
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";


/**
 * One window's model inputs, as `featurize.ts` produces them.
 *
 * `T === 2 + n + m`, and the token layout is
 * `[MARKER] s_1..s_n [MARKER] p_1..p_m`. The three integer inputs really do have
 * to be `BigInt64Array`: the graph declares them int64 and ORT throws at run
 * time — not at compile time — on an `Int32Array`.
 */
export interface ModelFeeds {
    /** Score notes in this window. */
    n: number;
    /** Performed notes in this window. */
    m: number;
    /** MIDI pitch per token, `MARKER_PITCH` at the two markers. Length `T`. */
    pitch: BigInt64Array;
    /** Continuous features, row-major `(T, 6)`. */
    cont: Float32Array;
    /** 0 for the score half (marker included), 1 for the perf half. Length `T`. */
    segment: BigInt64Array;
    /** Index within the segment, restarting at the perf marker. Length `T`. */
    position: BigInt64Array;
}

/**
 * The raw graph outputs for one window.
 *
 * Everything is still indexed by *token*, not by note — the marker tokens are
 * included — so `s` row `1 + i` is score note `i` and `p` row `2 + n + j` is
 * performed note `j`. Slicing that back to notes is the head's job.
 */
export interface EncoderOutput {
    n: number;
    m: number;
    /** `2 + n + m`. */
    T: number;
    /** `out_s(encoder output)`, row-major `(T, D_MODEL)`. */
    s: Float32Array;
    /** `out_p(encoder output)`, row-major `(T, D_MODEL)`. */
    p: Float32Array;
    /** Deletion logit per token, length `T`. Pre-projection — see `accumulate.ts`. */
    matchS: Float32Array;
    /** Insertion logit per token, length `T`. */
    matchP: Float32Array;
    /** The learned logit scale. A graph constant, but read it rather than hardcode it. */
    scale: number;
    /** The attribution head's score side, row-major `(T, D_MODEL)`, when asked for. */
    attrS?: Float32Array;
    /** Its performance side, row-major `(T, D_MODEL)`. */
    attrP?: Float32Array;
    /** The learned "not an ornament" vector, length `D_MODEL`. */
    attrNone?: Float32Array;
    /** The attribution head's own logit scale, which is not `scale`. */
    attrScale?: number;
    /**
     * `attr_gate` per token, length `T`. Only a `"factored"` graph emits it: it
     * is the logit of "this insertion elaborates a written note", read at the
     * performed tokens.
     */
    attrGate?: Float32Array;
}

/** What one forward pass should return. */
export interface RunOptions {
    /**
     * Also return the attribution head's vectors. Off by default because they
     * double what a window carries back, and most of the pipeline never looks
     * at them.
     */
    attribution?: boolean;
}

/** A loaded model, ready to run windows through. */
export interface MlignSession {
    /** Forward one window. Rejects rather than hanging if the window is too big. */
    run(feeds: ModelFeeds, options?: RunOptions): Promise<EncoderOutput>;
    /**
     * Whether this graph carries the ornament-attribution head at all.
     *
     * The alignment outputs are the same either way, so an older model still
     * runs; it simply cannot be asked which written note a played note
     * decorates. Read it rather than assuming, so that swapping the file in
     * `public/` is the only thing swapping a model takes.
     */
    readonly hasAttribution: boolean;
    /**
     * How this graph's attribution row has to be put together.
     *
     * Read off the graph's own output names, because that is the only thing
     * that is true of the weights themselves — a file can be renamed, copied or
     * served from anywhere, and a host that decided this from the URL would
     * quietly read a v3 row as a v2 one and get a number that means something
     * else. `"none"` for a graph with no attribution head at all, which reads
     * the same way as v2's for the code downstream: there is simply nothing to
     * read.
     */
    readonly attrConditioned: AttrConditioned;
    /** Free the WASM-side session. */
    release(): Promise<void>;
}


let ortConfigured = false;

/**
 * Point ORT at the bundled WASM binary and pin it to one thread. Idempotent;
 * ORT reads these only when the first session is created.
 */
function configureOrt(): void {
    if (ortConfigured) return;
    ortConfigured = true;

    ort.env.wasm.wasmPaths = { wasm: wasmUrl };

    // GitHub Pages cannot send COOP/COEP, so the page is never cross-origin
    // isolated, `SharedArrayBuffer` cannot cross to a worker, and threads can
    // never start. ORT falls back on its own, but pinning it keeps timings the
    // same on every machine instead of depending on that fallback.
    //
    // If this ever becomes a feature detect, test `crossOriginIsolated`, not
    // `typeof SharedArrayBuffer`: Chrome exposes the constructor even when the
    // page is not isolated, so the latter reports threads that cannot work.
    ort.env.wasm.numThreads = 1;
}

export interface CreateSessionOptions {
    /** Overrides `defaultModelUrl()`. Ignored when `modelBytes` is given. */
    modelUrl?: string;
    /** Pre-fetched weights, e.g. when the caller wants its own progress bar. */
    modelBytes?: Uint8Array;
}

/**
 * Fetch the weights and create the session. ~3.1 MB over the wire and a couple
 * of hundred milliseconds to build the graph, so do this once and keep it.
 */
export async function createMlignSession(
    options: CreateSessionOptions = {}
): Promise<MlignSession> {
    configureOrt();

    let bytes = options.modelBytes;
    if (!bytes) {
        const url = options.modelUrl ?? defaultModelUrl();
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`MLign: could not fetch ${url} (HTTP ${response.status})`);
        }
        bytes = new Uint8Array(await response.arrayBuffer());
    }

    const session = await ort.InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
    });

    const hasAttribution = session.outputNames.includes("attr_s");
    // The graph is the authority on which head it carries. `attr_gate` is the
    // one output v3 adds, and its presence is the whole of the detection.
    const attrConditioned: AttrConditioned =
        hasAttribution && session.outputNames.includes("attr_gate") ? "factored" : "none";

    const ALIGNMENT_OUTPUTS = ["s", "p", "match_s", "match_p", "scale"];
    const ATTRIBUTION_OUTPUTS = [
        ...ALIGNMENT_OUTPUTS,
        "attr_s",
        "attr_p",
        "attr_none",
        "attr_scale",
        ...(attrConditioned === "factored" ? ["attr_gate"] : []),
    ];

    return {
        hasAttribution,
        attrConditioned,

        async run(feeds: ModelFeeds, options: RunOptions = {}): Promise<EncoderOutput> {
            const { n, m } = feeds;
            const T = 2 + n + m;
            const wantAttribution = !!options.attribution && hasAttribution;

            let results: ort.InferenceSession.OnnxValueMapType;
            try {
                // Named rather than "everything": the attribution vectors are as
                // big as `s` and `p` together, and this is what makes asking for
                // them a choice rather than a cost the whole pipeline pays.
                results = await session.run(
                    {
                        pitch: new ort.Tensor("int64", feeds.pitch, [1, T]),
                        cont: new ort.Tensor("float32", feeds.cont, [1, T, 6]),
                        segment: new ort.Tensor("int64", feeds.segment, [1, T]),
                        position: new ort.Tensor("int64", feeds.position, [1, T]),
                    },
                    wantAttribution ? ATTRIBUTION_OUTPUTS : ALIGNMENT_OUTPUTS
                );
            } catch (cause) {
                // The relative-position bias is a dense (1, H, T, T) tensor and
                // ORT's WASM heap is 32-bit, so a long enough window exhausts it
                // as a `std::bad_alloc`. It is recoverable — the session stays
                // usable — so name the size rather than letting the UI hang.
                throw new Error(
                    `MLign: inference failed at ${T} tokens (${n} score, ${m} performed notes)`,
                    { cause }
                );
            }

            return {
                n,
                m,
                T,
                s: results.s.data as Float32Array,
                p: results.p.data as Float32Array,
                matchS: results.match_s.data as Float32Array,
                matchP: results.match_p.data as Float32Array,
                scale: (results.scale.data as Float32Array)[0],
                ...(wantAttribution
                    ? {
                          attrS: results.attr_s.data as Float32Array,
                          attrP: results.attr_p.data as Float32Array,
                          attrNone: results.attr_none.data as Float32Array,
                          attrScale: (results.attr_scale.data as Float32Array)[0],
                          ...(attrConditioned === "factored"
                              ? { attrGate: results.attr_gate.data as Float32Array }
                              : {}),
                      }
                    : {}),
            };
        },

        async release(): Promise<void> {
            await session.release();
        },
    };
}
