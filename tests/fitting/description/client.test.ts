/**
 * The describe desk's side of its worker: which requests are sent, and which are answered with
 * what. The worker is one of the test's own, answering when it is told to.
 */
import { describe, expect, it } from 'vitest';
import {
    createDescriptionClient,
    type BroughtOut,
    type DescriptionRun,
} from '../../../src/fitting/description/client';
import type {
    DescriptionReply,
    DescriptionRequest,
} from '../../../src/fitting/description/description.worker';
import type { AlignmentData } from '../../../src/fitting/fit.worker';
import type { Call } from '../../../src/model/Work';

class ScriptedWorker {
    posted: DescriptionRequest[] = [];
    terminated = false;
    onmessage: ((event: MessageEvent<DescriptionReply>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;

    postMessage(request: DescriptionRequest) {
        this.posted.push(request);
    }
    terminate() {
        this.terminated = true;
    }
    reply(reply: DescriptionReply) {
        this.onmessage?.({ data: reply } as MessageEvent<DescriptionReply>);
    }
    /** The requests of one kind, in the order they were posted. */
    asked<T extends DescriptionRequest['type']>(type: T) {
        return this.posted.filter(
            (request): request is Extract<DescriptionRequest, { type: T }> => request.type === type,
        );
    }
}

const alignment = (): AlignmentData => ({
    allNotes: [],
    pedals: [],
    graces: [],
    tiedPrincipals: [],
    timeSignatures: [],
});
const calls = (id: string): Call[] => [{ id, name: 'InsertTempo', options: {} }];
const runOf = (mpm: string) => ({ mpm, score: `${mpm}.msm` }) as DescriptionRun;
const settled = async <T>(promise: Promise<T>) => {
    let state: 'pending' | T = 'pending';
    void promise.then((value) => (state = value));
    await Promise.resolve();
    await Promise.resolve();
    return state;
};

const started = () => {
    const workers: ScriptedWorker[] = [];
    const client = createDescriptionClient(() => {
        const worker = new ScriptedWorker();
        workers.push(worker);
        return worker as unknown as Worker;
    });
    return { client, workers };
};

describe('the description client', () => {
    it('starts the worker with the first request, and hands it the alignment once', async () => {
        const { client, workers } = started();
        expect(workers).toHaveLength(0);

        const data = alignment();
        const first = client.describe(data, calls('a'));
        const [worker] = workers;
        expect(worker?.posted.map((request) => request.type)).toEqual(['load', 'describe']);
        expect(worker?.asked('load')[0]?.alignment).toBe(data);

        worker?.reply({
            type: 'described',
            requestId: worker.asked('describe')[0]!.requestId,
            run: runOf('one'),
        });
        expect(await first).toEqual(runOf('one'));

        // The same alignment is not sent again, whatever object carries it; another one is.
        void client.describe({ ...data }, calls('b'));
        expect(worker?.asked('load')).toHaveLength(1);
        worker?.reply({
            type: 'described',
            requestId: worker.asked('describe')[1]!.requestId,
            run: runOf('two'),
        });
        void client.describe({ ...data, allNotes: [] }, calls('c'));
        expect(worker?.asked('load')).toHaveLength(2);
        expect(workers).toHaveLength(1);
    });

    it('runs only the newest of the requests made while one runs, and answers them all with it', async () => {
        const { client, workers } = started();
        const data = alignment();
        const first = client.describe(data, calls('a'));
        const second = client.describe(data, calls('b'));
        const third = client.describe(data, calls('c'));
        const worker = workers[0]!;
        expect(worker.asked('describe').map((request) => request.calls[0]?.id)).toEqual(['a']);

        // The run that was overtaken is answered to nobody: it is of a document edited past.
        worker.reply({
            type: 'described',
            requestId: worker.asked('describe')[0]!.requestId,
            run: runOf('stale'),
        });
        expect(await settled(first)).toBe('pending');
        expect(worker.asked('describe').map((request) => request.calls[0]?.id)).toEqual(['a', 'c']);

        worker.reply({
            type: 'described',
            requestId: worker.asked('describe')[1]!.requestId,
            run: runOf('newest'),
        });
        expect(await Promise.all([first, second, third])).toEqual([
            runOf('newest'),
            runOf('newest'),
            runOf('newest'),
        ]);

        // Nothing is running now, so the next request goes out at once.
        void client.describe(data, calls('d'));
        expect(worker.asked('describe').map((request) => request.calls[0]?.id)).toEqual([
            'a',
            'c',
            'd',
        ]);
    });

    it('always runs a trial, and answers it with its own run', async () => {
        const { client, workers } = started();
        const data = alignment();
        const plain = client.describe(data, calls('a'));
        const trial = {
            remark: 'r1',
            steps: [{ name: 'FitTempo', options: { from: 0, to: 720 } }],
        };
        const tried = client.describe(data, calls('a'), { trial });
        const again = client.describe(data, calls('a'), { trial });
        const worker = workers[0]!;
        const asked = worker.asked('describe');
        expect(asked.map((request) => request.trial)).toEqual([undefined, trial, trial]);

        worker.reply({ type: 'described', requestId: asked[1]!.requestId, run: runOf('tried') });
        worker.reply({ type: 'described', requestId: asked[2]!.requestId, run: runOf('again') });
        expect(await tried).toEqual(runOf('tried'));
        expect(await again).toEqual(runOf('again'));
        // The plain request is neither answered by a trial nor overtaken by one.
        expect(await settled(plain)).toBe('pending');
        worker.reply({ type: 'described', requestId: asked[0]!.requestId, run: runOf('plain') });
        expect(await plain).toEqual(runOf('plain'));
    });

    it('answers every bringing out, each with its own rendering', async () => {
        const { client, workers } = started();
        const result = (spared: string): BroughtOut => ({ notes: [], pedal: [], spared: [spared] });
        const louder = client.bringOut(runOf('m'), ['dynamics_0'], 1.8, 0.35);
        const faster = client.bringOut(runOf('m'), ['tempo_0'], 1.5, 0.5);
        const worker = workers[0]!;
        const asked = worker.asked('bring-out');
        // No alignment is needed for it: the run brings its own score.
        expect(worker.posted.map((request) => request.type)).toEqual(['bring-out', 'bring-out']);
        expect(asked[0]).toMatchObject({
            run: { mpm: 'm', score: 'm.msm' },
            ids: ['dynamics_0'],
            factor: 1.8,
            attenuation: 0.35,
        });

        worker.reply({
            type: 'brought-out',
            requestId: asked[1]!.requestId,
            result: result('tempo'),
        });
        worker.reply({
            type: 'brought-out',
            requestId: asked[0]!.requestId,
            result: result('dynamics'),
        });
        expect((await louder).spared).toEqual(['dynamics']);
        expect((await faster).spared).toEqual(['tempo']);
    });

    it('rejects with what the worker could not do', async () => {
        const { client, workers } = started();
        const data = alignment();
        const plain = client.describe(data, calls('a'));
        const out = client.bringOut(runOf('m'), [], 1, 1);
        const worker = workers[0]!;
        worker.reply({
            type: 'error',
            requestId: worker.asked('describe')[0]!.requestId,
            message: 'more than one reading',
        });
        worker.reply({
            type: 'error',
            requestId: worker.asked('bring-out')[0]!.requestId,
            message: 'no score',
        });
        await expect(plain).rejects.toThrow('more than one reading');
        await expect(out).rejects.toThrow('no score');
    });

    it('stops the worker when disposed of, and starts another when asked again', () => {
        const { client, workers } = started();
        const data = alignment();
        void client.describe(data, calls('a'));
        client.dispose();
        expect(workers[0]?.terminated).toBe(true);

        void client.describe(data, calls('b'));
        expect(workers).toHaveLength(2);
        expect(workers[1]?.posted.map((request) => request.type)).toEqual(['load', 'describe']);
    });
});
