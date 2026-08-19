/**
 * Promise-shaped access to `espressivo.worker.ts`.
 *
 * One worker for the page, created on first use so that importing this module stays free in
 * tests and on the server. One persistent `message` listener dispatches by request id into a
 * pending map; attaching a listener per request would drop results whose caller unmounted
 * mid-flight.
 */
import type { EspressivoRequest, EspressivoResponse } from '../espressivo.worker';
import type { RenderRequest } from './espressivo';

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, Pending>();

const getWorker = (): Worker => {
    if (worker) return worker;

    worker = new Worker(new URL('../espressivo.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<EspressivoResponse>) => {
        const data = event.data;
        const entry = pending.get(data.requestId);
        if (!entry) return;
        pending.delete(data.requestId);

        if (data.type === 'espressivo-error') entry.reject(new Error(data.error));
        else entry.resolve(data as never);
    });
    worker.addEventListener('error', event => {
        const error = new Error(event.message || 'espressivo worker failed');
        for (const entry of pending.values()) entry.reject(error);
        pending.clear();
    });

    return worker;
};

const request = <T extends EspressivoResponse>(
    message: Omit<EspressivoRequest, 'requestId'>,
): Promise<T> => {
    const requestId = ++nextRequestId;
    const instance = getWorker();
    return new Promise<T>((resolve, reject) => {
        pending.set(requestId, { resolve: resolve as Pending['resolve'], reject });
        instance.postMessage({ ...message, requestId } as EspressivoRequest);
    });
};

/** MSM + MPM ⇒ expressive MIDI bytes. */
export const renderPerformance = async (renderRequest: RenderRequest): Promise<ArrayBuffer> => {
    const { midi } = await request<Extract<EspressivoResponse, { type: 'render-result' }>>({
        type: 'render',
        request: renderRequest,
    });
    return midi;
};
