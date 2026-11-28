import Anthropic, {
    AnthropicError,
    APIConnectionError,
    APIError,
    APIUserAbortError,
    AuthenticationError,
    OverloadedError,
    PermissionDeniedError,
    RateLimitError,
} from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DescriptionRun, RollNote, Step } from '../../../fitting/description/client';
import { expertThrough, senderWith, type Send } from './anthropic';
import { ExpertError } from './failure';
import { buildPrompt, KNOWLEDGE } from './prompt';
import type { ExpertFailure, ExpertRequest } from './types';

/**
 * The conversation with the model, against a scripted stand-in for the API: what is sent, what
 * is sent back after a trial, when it ends and with what, and what every way of failing is
 * called. Then the request itself, as the SDK puts it on the wire, against a stand-in for the
 * network. No request of these tests leaves the machine.
 */

type Message = Anthropic.Beta.BetaMessage;
const MODEL = 'claude-opus-5-5';

const note = (id: string, pitch: number, date: number, ms: number): RollNote => ({
    id,
    part: 1,
    pitch,
    date,
    duration: 720,
    ms,
    msEnd: ms + 500,
    velocity: 40,
    mpm: { ms, msEnd: ms + 500, velocity: 40 },
    late: 0,
    longMs: 0,
    loud: 0,
});

/** Two quarters in one bar of two, described by nothing. */
const RUN: DescriptionRun = {
    mpm: '<mpm />',
    score: '<msm><note xml:id="a" date="0" midi.pitch="60" pitchname="c" accidentals="0" /></msm>',
    roll: {
        notes: [note('a', 60, 0, 0), note('b', 62, 720, 600)],
        graces: [],
        pedals: { played: [], mpm: [] },
        beats: [],
        assumed: { tempo: [{ from: 0, to: 1440, bpm: 100 }], level: 40, levelDates: [0] },
        level: 40,
        end: 1440,
        timeSignatures: [{ date: 0, numerator: 2, denominator: 4 }],
    },
    remarks: [],
    problems: [],
};

/** The run of a trial: its one step wrote a tempo. */
const TRIED: DescriptionRun = {
    ...RUN,
    remarks: [
        {
            id: 'asked',
            concrete: [],
            steps: [
                {
                    calls: ['asked.0.0'],
                    elements: ['tempo_0'],
                    written: ['<tempo date="0" bpm="100" beatLength="0.25" xml:id="tempo_0" />'],
                    definitions: [],
                    evidence: ['a', 'b'],
                    fitted: [],
                    range: { from: 0, to: 1440 },
                },
            ],
        },
    ],
};

const TEMPO: Step = { name: 'FitTempo', options: { from: 0, to: 1440 } };
const ANSWER = JSON.stringify({ steps: [TEMPO], question: null });

const requestWith = (tryOut: ExpertRequest['tryOut'] = () => Promise.resolve(TRIED)) => ({
    remark: {
        id: 'asked',
        text: 'steady',
        about: { kind: 'piece' as const, from: 0, to: 0, notes: [] },
        steps: [],
    },
    thread: [],
    others: [],
    run: RUN,
    piece: { title: 'Two quarters', ppq: 720, bars: [{ n: 1, from: 0, to: 1440 }] },
    tryOut: vi.fn(tryOut),
});

const message = (content: unknown[], stop_reason = 'end_turn', model = MODEL) =>
    ({ id: 'msg', type: 'message', role: 'assistant', model, content, stop_reason }) as Message;
const text = (said: string) => ({ type: 'text', text: said });
const thought = (signature: string) => ({ type: 'thinking', thinking: '', signature });
const call = (id: string, input: unknown = { steps: [TEMPO] }) => ({
    type: 'tool_use',
    id,
    name: 'try_steps',
    input,
});
const trying = (id: string) => message([thought(`before-${id}`), call(id)], 'tool_use');
const answering = message([text(ANSWER)]);

/** A stand-in that answers each request with the next turn of a script, or fails with it. */
const scripted = (...turns: (Message | Error)[]) => {
    let next = 0;
    return vi.fn<Send>(() => {
        const turn = turns[Math.min(next++, turns.length - 1)]!;
        return turn instanceof Error ? Promise.reject(turn) : Promise.resolve(turn);
    });
};

const failure = async (asking: Promise<unknown>): Promise<ExpertFailure> => {
    const thrown: unknown = await asking.then(
        () => undefined,
        (reason: unknown) => reason,
    );
    expect(thrown).toBeInstanceOf(ExpertError);
    return (thrown as ExpertError).reason;
};

const asked = (send: ReturnType<typeof scripted>, turn: number) => send.mock.calls[turn]![0];
const results = (send: ReturnType<typeof scripted>, turn: number) =>
    asked(send, turn).messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];

describe('a try, then an answer', () => {
    it('asks with the knowledge kept, thinking as it sees fit, and nothing forced', async () => {
        const send = scripted(answering);
        const request = requestWith();
        await expertThrough(send, MODEL).ask(request);

        expect(send).toHaveBeenCalledTimes(1);
        const { messages, system, tools, ...rest } = asked(send, 0);
        expect(rest).toEqual({
            model: MODEL,
            max_tokens: 64000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'high' },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            cache_control: { type: 'ephemeral' },
        });
        expect(system).toEqual([
            { type: 'text', text: KNOWLEDGE, cache_control: { type: 'ephemeral' } },
        ]);
        expect(tools).toEqual([
            expect.objectContaining({ name: 'try_steps', eager_input_streaming: true }),
        ]);
        expect(messages).toEqual([{ role: 'user', content: buildPrompt(request) }]);
    });

    it('answers with the steps, and names the model that answered', async () => {
        const send = scripted(trying('toolu_1'), message([text(ANSWER)], 'end_turn', 'claude-opus-4-8'));
        const request = requestWith();
        const lines: string[] = [];
        const answer = await expertThrough(send, MODEL).ask(request, {
            onProgress: (line) => lines.push(line),
        });

        expect(answer).toEqual({ steps: [TEMPO], question: null, model: 'claude-opus-4-8' });
        expect(request.tryOut).toHaveBeenCalledExactlyOnceWith([TEMPO]);
        expect(lines).toEqual([
            'Reading the passage…',
            'Trying 1 step on the roll…',
            'Reading what the trial left…',
        ]);
    });

    it('sends the turn back whole, its thinking with it, and the trial after it', async () => {
        const first = trying('toolu_1');
        const send = scripted(first, answering);
        await expertThrough(send, MODEL).ask(requestWith());

        const [before, after] = [asked(send, 0), asked(send, 1)];
        expect(after.messages).toHaveLength(3);
        // Everything that went before stands as it stood: the API checks the thinking against it.
        expect(after.messages[0]).toBe(before.messages[0]);
        expect(after.system).toEqual(before.system);
        expect(after.tools).toEqual(before.tools);
        expect(after.messages[1]).toEqual({ role: 'assistant', content: first.content });

        const [result, ...more] = results(send, 1);
        expect(more).toEqual([]);
        expect(result).toEqual({
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: expect.any(String),
        });
        expect(JSON.parse(result!.content as string)).toMatchObject({
            steps: [{ step: 0, name: 'FitTempo', wrote: ['tempo x1'], fitted_to_notes: 2 }],
            left_in_piece: { before: { notes: 2 }, after: { notes: 2 } },
        });
    });

    it('answers every call of a turn in one message, in their order', async () => {
        const both = message([call('toolu_1'), call('toolu_2')], 'tool_use');
        const send = scripted(both, answering);
        const request = requestWith();
        await expertThrough(send, MODEL).ask(request);
        expect(results(send, 1).map((result) => result.tool_use_id)).toEqual(['toolu_1', 'toolu_2']);
        expect(request.tryOut).toHaveBeenCalledTimes(2);
    });

    it('passes on a question, and no steps with it', async () => {
        const send = scripted(message([text('{"steps": [], "question": "Which chord?"}')]));
        expect(await expertThrough(send, MODEL).ask(requestWith())).toEqual({
            steps: [],
            question: 'Which chord?',
            model: MODEL,
        });
    });
});

describe('the tries', () => {
    it('are three: a fourth is answered with an error, and the answer still taken', async () => {
        const send = scripted(trying('1'), trying('2'), trying('3'), trying('4'), answering);
        const request = requestWith();
        const answer = await expertThrough(send, MODEL).ask(request);

        expect(answer.steps).toEqual([TEMPO]);
        expect(request.tryOut).toHaveBeenCalledTimes(3);
        expect(results(send, 3)[0]).not.toHaveProperty('is_error');
        expect(results(send, 4)[0]).toEqual({
            type: 'tool_result',
            tool_use_id: '4',
            content: expect.stringMatching(/used 3 times/),
            is_error: true,
        });
    });

    it('do not count an input that cannot be read, which is handed back to be written again', async () => {
        const unreadable = message([call('bad', { steps: 'FitTempo' })], 'tool_use');
        const send = scripted(unreadable, trying('1'), trying('2'), trying('3'), answering);
        const request = requestWith();
        await expertThrough(send, MODEL).ask(request);

        expect(results(send, 1)[0]).toEqual({
            type: 'tool_result',
            tool_use_id: 'bad',
            content: JSON.stringify({ INVALID_JSON: '{"steps":"FitTempo"}' }),
            is_error: true,
        });
        expect(request.tryOut).toHaveBeenCalledTimes(3);
        expect(results(send, 4)[0]).not.toHaveProperty('is_error');
    });

    it('end with a model that goes on trying and never answers', async () => {
        const send = scripted(trying('again'));
        expect(await failure(expertThrough(send, MODEL).ask(requestWith()))).toBe('unreadable');
        expect(send).toHaveBeenCalledTimes(8);
    });
});

describe('a turn that is no answer', () => {
    it('is declined where the model refused, and nothing in it is run', async () => {
        const request = requestWith();
        const refused = message([call('half', { steps: [] })], 'refusal');
        expect(await failure(expertThrough(scripted(refused), MODEL).ask(request))).toBe('declined');
        expect(request.tryOut).not.toHaveBeenCalled();

        const atOnce = message([], 'refusal');
        expect(await failure(expertThrough(scripted(atOnce), MODEL).ask(request))).toBe('declined');
    });

    it('is unreadable where it was cut off, whatever it holds', async () => {
        const request = requestWith();
        const cut = message([call('half', { steps: [TEMPO] })], 'max_tokens');
        expect(await failure(expertThrough(scripted(cut), MODEL).ask(request))).toBe('unreadable');
        expect(request.tryOut).not.toHaveBeenCalled();

        const midAnswer = message([text('{"steps": [{"name": "FitTempo"}], "question": null}')], 'max_tokens');
        expect(await failure(expertThrough(scripted(midAnswer), MODEL).ask(request))).toBe('unreadable');
    });

    it('is unreadable where it holds no steps and no question', async () => {
        const send = scripted(message([thought('only'), text('I would roll the chords.')]));
        expect(await failure(expertThrough(send, MODEL).ask(requestWith()))).toBe('unreadable');
    });
});

describe('a turn another model took over', () => {
    const handover = { type: 'fallback', from: { model: MODEL }, to: { model: 'claude-opus-4-8' } };

    it('is sent back without what the first thought and called, and only the second is answered', async () => {
        const taken = message(
            [thought('first'), text('Let me try.'), call('old'), handover, thought('second'), call('new')],
            'tool_use',
            'claude-opus-4-8',
        );
        const send = scripted(taken, answering);
        const request = requestWith();
        await expertThrough(send, MODEL).ask(request);

        expect(asked(send, 1).messages[1]).toEqual({
            role: 'assistant',
            content: [text('Let me try.'), handover, thought('second'), call('new')],
        });
        expect(results(send, 1).map((result) => result.tool_use_id)).toEqual(['new']);
        expect(request.tryOut).toHaveBeenCalledTimes(1);
    });

    it('is read whole where the answer was begun by one and finished by the other', async () => {
        const [begun, finished] = [ANSWER.slice(0, 20), ANSWER.slice(20)];
        const send = scripted(message([text(begun), handover, text(finished)], 'end_turn', 'claude-opus-4-8'));
        expect(await expertThrough(send, MODEL).ask(requestWith())).toEqual({
            steps: [TEMPO],
            question: null,
            model: 'claude-opus-4-8',
        });
    });
});

describe('what goes wrong', () => {
    const body = (type: string) => ({ type: 'error', error: { type, message: 'no' } });
    const answered = (status: number, type: string) =>
        APIError.generate(status, body(type), undefined, new Headers());
    /** An error that arrives as an event of the stream, after the status has been 200. */
    const streamed = (type: string) =>
        new APIError(undefined, body(type), undefined, new Headers(), type as APIError['type']);

    it('is made by the SDK into the classes the reasons are read from', () => {
        expect(answered(401, 'authentication_error')).toBeInstanceOf(AuthenticationError);
        expect(answered(403, 'permission_error')).toBeInstanceOf(PermissionDeniedError);
        expect(answered(429, 'rate_limit_error')).toBeInstanceOf(RateLimitError);
        expect(answered(529, 'overloaded_error')).toBeInstanceOf(OverloadedError);
    });

    it.each<[string, Error, ExpertFailure]>([
        ['a key the API does not know', answered(401, 'authentication_error'), 'key'],
        ['a key that may not do this', answered(403, 'permission_error'), 'key'],
        ['a key refused mid-stream', streamed('authentication_error'), 'key'],
        ['too many requests', answered(429, 'rate_limit_error'), 'busy'],
        ['an API that is overloaded', answered(529, 'overloaded_error'), 'busy'],
        ['an API overloaded mid-stream', streamed('overloaded_error'), 'busy'],
        ['a limit reached mid-stream', streamed('rate_limit_error'), 'busy'],
        ['a request the API cannot take', answered(400, 'invalid_request_error'), 'failed'],
        ['a model it does not know', answered(404, 'not_found_error'), 'failed'],
        ['an account without credit', answered(402, 'billing_error'), 'failed'],
        ['a fault of the API', answered(500, 'api_error'), 'failed'],
        ['no connection', new APIConnectionError({ message: 'Connection error.' }), 'failed'],
    ])('calls %s by its reason, and does not ask again', async (_what, thrown, reason) => {
        const send = scripted(thrown);
        const asking = expertThrough(send, MODEL).ask(requestWith());
        expect(await failure(asking)).toBe(reason);
        expect(send).toHaveBeenCalledTimes(1);
        await expect(asking).rejects.toMatchObject({ cause: thrown });
    });

    it('asks a turn again whose tool call could not be parsed, twice at most', async () => {
        const garbled = new AnthropicError('Unable to parse tool parameter JSON from model.');
        const once = scripted(garbled, answering);
        expect((await expertThrough(once, MODEL).ask(requestWith())).steps).toEqual([TEMPO]);
        expect(once).toHaveBeenCalledTimes(2);
        expect(asked(once, 1)).toEqual(asked(once, 0));

        const always = scripted(garbled);
        expect(await failure(expertThrough(always, MODEL).ask(requestWith()))).toBe('failed');
        expect(always).toHaveBeenCalledTimes(3);
    });
});

describe('a reader who stops it', () => {
    it('is not asked for at all where it was stopped before', async () => {
        const stop = new AbortController();
        stop.abort();
        const send = scripted(answering);
        const asking = expertThrough(send, MODEL).ask(requestWith(), { signal: stop.signal });
        expect(await failure(asking)).toBe('stopped');
        expect(send).not.toHaveBeenCalled();
    });

    it('stops the request on its way, which is handed the signal', async () => {
        const stop = new AbortController();
        const send = vi.fn<Send>(
            (_asked, signal) =>
                new Promise((_resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(new APIUserAbortError()));
                }),
        );
        const asking = expertThrough(send, MODEL).ask(requestWith(), { signal: stop.signal });
        stop.abort();
        expect(await failure(asking)).toBe('stopped');
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.anything(), stop.signal);
    });

    it('is stopped whatever the request failed with once it was stopped, and not asked again', async () => {
        const stop = new AbortController();
        const send = vi.fn<Send>(() => {
            stop.abort();
            return Promise.reject(new TypeError('network error'));
        });
        const asking = expertThrough(send, MODEL).ask(requestWith(), { signal: stop.signal });
        expect(await failure(asking)).toBe('stopped');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('stops after a trial that was under way, before anything more is sent', async () => {
        const stop = new AbortController();
        const send = scripted(trying('1'), answering);
        const request = requestWith(() => {
            stop.abort();
            return Promise.resolve(TRIED);
        });
        const asking = expertThrough(send, MODEL).ask(request, { signal: stop.signal });
        expect(await failure(asking)).toBe('stopped');
        expect(send).toHaveBeenCalledTimes(1);
    });
});

describe('the request on the wire', () => {
    const KEY = 'sk-ant-the-readers-own';
    const events = (...sent: object[]) =>
        sent.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
    const START = {
        type: 'message_start',
        message: { ...message([]), stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    };
    const stopped = (stop_reason: string) => [
        { type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 9 } },
        { type: 'message_stop' },
    ];
    /** The stream of a message that is one block of text. */
    const saying = (said: string) =>
        events(
            START,
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: said } },
            { type: 'content_block_stop', index: 0 },
            ...stopped('end_turn'),
        );
    /** The stream of a turn that thinks and then calls the tool, its input arriving in pieces. */
    const calling = (id: string, input: string) =>
        events(
            START,
            { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name: 'try_steps', input: {} } },
            ...[input.slice(0, 7), input.slice(7, 30), input.slice(30)].map((partial_json) => ({
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'input_json_delta', partial_json },
            })),
            { type: 'content_block_stop', index: 1 },
            ...stopped('tool_use'),
        );
    const stream = (body: string) =>
        new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    const network = (...responses: (() => Response)[]) => {
        const fetched = vi.fn<typeof fetch>(() => Promise.resolve(responses.shift()!()));
        vi.stubGlobal('fetch', fetched);
        return fetched;
    };

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('goes from the browser to the API with the key, streamed, and comes back as the answer', async () => {
        const fetched = network(() => stream(saying(ANSWER)));
        const request = requestWith();
        const answer = await expertThrough(senderWith(KEY), MODEL).ask(request);
        expect(answer).toEqual({ steps: [TEMPO], question: null, model: MODEL });

        expect(fetched).toHaveBeenCalledTimes(1);
        const [url, init] = fetched.mock.calls[0]!;
        expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
        expect(init?.method?.toUpperCase()).toBe('POST');
        const headers = new Headers(init?.headers);
        expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
        expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
        // The key travels in a header, whichever the SDK sends it in, and nowhere else.
        expect([...headers.values()].filter((value) => value.includes(KEY))).toHaveLength(1);
        expect(init?.body).not.toContain(KEY);

        const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
        expect(sent).toMatchObject({
            model: MODEL,
            stream: true,
            max_tokens: 64000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'high' },
            fallbacks: 'default',
            cache_control: { type: 'ephemeral' },
            system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
            tools: [{ name: 'try_steps', eager_input_streaming: true }],
            messages: [{ role: 'user', content: buildPrompt(request) }],
        });
        expect(sent).not.toHaveProperty('betas');
        expect(sent).not.toHaveProperty('tool_choice');
    });

    it('reads a tool call as it was streamed, and sends the turn back as it came', async () => {
        const fetched = network(
            () => stream(calling('toolu_1', JSON.stringify({ steps: [TEMPO] }))),
            () => stream(saying(ANSWER)),
        );
        const request = requestWith();
        const answer = await expertThrough(senderWith(KEY), MODEL).ask(request);

        expect(answer.steps).toEqual([TEMPO]);
        expect(request.tryOut).toHaveBeenCalledExactlyOnceWith([TEMPO]);
        const { messages } = JSON.parse(fetched.mock.calls[1]![1]?.body as string) as {
            messages: { role: string; content: unknown }[];
        };
        expect(messages).toHaveLength(3);
        expect(messages[1]).toEqual({
            role: 'assistant',
            content: [
                { type: 'thinking', thinking: '', signature: 'signed' },
                { type: 'tool_use', id: 'toolu_1', name: 'try_steps', input: { steps: [TEMPO] } },
            ],
        });
        expect(messages[2]).toEqual({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: expect.any(String) }],
        });
    });

    it('fails on a key the API refuses, and carries the key in nothing it throws', async () => {
        network(() => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 }));
        const thrown: unknown = await expertThrough(senderWith(KEY), MODEL)
            .ask(requestWith())
            .catch((reason: unknown) => reason);

        expect(thrown).toBeInstanceOf(ExpertError);
        const error = thrown as ExpertError;
        expect(error.reason).toBe('key');
        expect(error.cause).toBeInstanceOf(AuthenticationError);
        const told = [error.message, error.stack, String(error.cause), JSON.stringify(error.cause)];
        expect(told.join('\n')).not.toContain(KEY);
    });
});
