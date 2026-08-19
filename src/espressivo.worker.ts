/**
 * Runs espressivo off the main thread.
 *
 * Converting this project's MEI takes ~5 s and rendering a performance ~170 ms; both used to
 * be network calls to the Java backend, so both were already off the main thread. Keeping
 * them here preserves that — a synchronous conversion would freeze the page, loading screen
 * included, for the whole five seconds.
 */
import { convertMei, renderPerformance, type RenderRequest } from './utils/espressivo';

export interface ConvertMessage {
    type: 'convert';
    requestId: number;
    mei: string;
}

export interface RenderMessage {
    type: 'render';
    requestId: number;
    request: RenderRequest;
}

export type EspressivoRequest = ConvertMessage | RenderMessage;

export interface ConvertResult {
    type: 'convert-result';
    requestId: number;
    msm: string;
    mpm: string;
}

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

export type EspressivoResponse = ConvertResult | RenderResult | EspressivoError;

const post = (message: EspressivoResponse, transfer?: Transferable[]) => {
    if (transfer) self.postMessage(message, { transfer });
    else self.postMessage(message);
};

self.onmessage = (event: MessageEvent<EspressivoRequest>) => {
    const data = event.data;

    try {
        if (data.type === 'convert') {
            const { msm, mpm } = convertMei(data.mei);
            post({ type: 'convert-result', requestId: data.requestId, msm, mpm });
            return;
        }

        if (data.type === 'render') {
            const midi = renderPerformance(data.request);
            // Copy out of the (possibly pooled) view so the buffer we transfer is exactly
            // the MIDI file and nothing else.
            const buffer = midi.slice().buffer;
            post({ type: 'render-result', requestId: data.requestId, midi: buffer }, [buffer]);
            return;
        }
    } catch (error) {
        post({
            type: 'espressivo-error',
            requestId: data.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
