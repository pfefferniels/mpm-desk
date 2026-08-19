/**
 * Runs espressivo off the main thread.
 *
 * Rendering a performance takes ~170 ms and used to be a network call to the Java backend,
 * so it was already off the main thread. Keeping it here preserves that: playback re-renders
 * on every zoom step and on every segment preview, and a synchronous render would show as a
 * stutter each time.
 */
import { renderPerformance, type RenderRequest } from './utils/espressivo';

export interface RenderMessage {
    type: 'render';
    requestId: number;
    request: RenderRequest;
}

export type EspressivoRequest = RenderMessage;

export interface RenderResult {
    type: 'render-result';
    requestId: number;
    midi: ArrayBuffer;
}

export interface EspressivoError {
    type: 'espressivo-error';
    requestId: number;
    error: string;
}

export type EspressivoResponse = RenderResult | EspressivoError;

const post = (message: EspressivoResponse, transfer?: Transferable[]) => {
    if (transfer) self.postMessage(message, { transfer });
    else self.postMessage(message);
};

self.onmessage = (event: MessageEvent<EspressivoRequest>) => {
    const data = event.data;

    try {
        const midi = renderPerformance(data.request);
        // Copy out of the (possibly pooled) view so the buffer we transfer is exactly
        // the MIDI file and nothing else.
        const buffer = midi.slice().buffer;
        post({ type: 'render-result', requestId: data.requestId, midi: buffer }, [buffer]);
    } catch (error) {
        post({
            type: 'espressivo-error',
            requestId: data.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
