const DEFAULT_BACKEND_BASE_URL = 'http://localhost:8080';

const trimTrailingSlash = (url: string) => url.replace(/\/+$/, '');

const BACKEND_BASE_URL = trimTrailingSlash(
    import.meta.env.VITE_MPM_BACKEND_URL || DEFAULT_BACKEND_BASE_URL
);

const postJson = async (path: string, payload: unknown): Promise<Response> => {
    return fetch(`${BACKEND_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
};

const responseError = (action: string, response: Response) => {
    return new Error(`${action} failed: ${response.status} ${response.statusText}`);
};

export const convertMeiToMsm = async (mei: string): Promise<string> => {
    const response = await postJson('/convert', { mei });
    if (!response.ok) throw responseError('MEI to MSM conversion', response);

    const payload = await response.json() as { msm?: unknown };
    if (typeof payload.msm !== 'string') {
        throw new Error('MEI to MSM conversion failed: missing msm payload');
    }
    return payload.msm;
};

export interface PerformRequest {
    mpm: string;
    mei: string;
    mpmIds?: string[];
    exaggerate?: number;
    exemplify?: boolean;
    context?: number;
    isolate?: boolean;
}

export const performMpm = async (request: PerformRequest): Promise<string> => {
    const response = await postJson('/perform', request);
    if (!response.ok) throw responseError('Playback request', response);

    const payload = await response.json() as { midi_b64?: unknown };
    if (typeof payload.midi_b64 !== 'string') {
        throw new Error('Playback request failed: missing midi_b64 payload');
    }
    return payload.midi_b64;
};

export const convertMpmToMidi = async (mpm: string): Promise<ArrayBuffer> => {
    const response = await postJson('/convert', { mpm });
    if (!response.ok) throw responseError('MPM to MIDI conversion', response);
    return response.arrayBuffer();
};
