/**
 * What the corpus scripts need of a browser, under Node.
 *
 * The app reads its documents with the platform `DOMParser` and runs the aligner on
 * onnxruntime-web, whose WebAssembly binary a page fetches by URL. Node has neither a parser nor
 * a site to fetch from, so the parser comes from jsdom and the binary is handed to the runtime as
 * bytes. Import this before anything from `src/`.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as ort from 'onnxruntime-web/wasm';
import { createMlignSession } from '../../src/alignment/mlign/session';
import type { MlignSession } from '../../src/alignment/mlign/session';

const dom = new JSDOM();
const scope = globalThis as unknown as Record<string, unknown>;
scope.DOMParser ??= dom.window.DOMParser;
scope.XMLSerializer ??= dom.window.XMLSerializer;
// `src/` escapes ids for selectors with the platform's `CSS.escape`, which Node lacks. The ids
// of an MEI file are XML names, so a backslash before anything a selector could misread does.
scope.CSS ??= { escape: (value: string) => value.replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, '\\$&') };

let session: Promise<MlignSession> | undefined;

/** The shipped checkpoint, loaded once. */
export const nodeSession = (): Promise<MlignSession> => {
    if (!session) {
        const wasm = readFileSync('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm');
        ort.env.wasm.wasmBinary = wasm.buffer.slice(
            wasm.byteOffset,
            wasm.byteOffset + wasm.byteLength,
        );
        session = createMlignSession({
            modelBytes: new Uint8Array(readFileSync('public/mlign-v4-fp16.onnx')),
        });
    }
    return session;
};
