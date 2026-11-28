/**
 * The expert asked through the Anthropic API.
 *
 * The Desk is a static site: there is no server to ask for it, so the request leaves the reader's
 * browser with the reader's own key. This module is loaded with the first question, which keeps
 * the SDK out of the Desk's own bundle.
 */
import Anthropic, {
    APIError,
    APIUserAbortError,
    AuthenticationError,
    OverloadedError,
    PermissionDeniedError,
    RateLimitError,
} from '@anthropic-ai/sdk';
import { readAnswer } from './answer';
import { ExpertError } from './failure';
import { KNOWLEDGE, buildPrompt } from './prompt';
import { trialOf, TRY_STEPS } from './trial';
import type { Expert, ExpertAnswer, ExpertFailure, ExpertRequest } from './types';

type Message = Anthropic.Beta.BetaMessage;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;
type Asked = Parameters<Anthropic['beta']['messages']['stream']>[0];

/** Sends one request, and answers with the whole message once all of it has arrived. */
export type Send = (asked: Asked, signal?: AbortSignal) => Promise<Message>;

/**
 * How many turns a remark gets: its tries, its answer, and a few more for a tool call that has to
 * be written again. A model that goes on calling the tool past them is not going to answer.
 */
const TURNS = 8;

export const senderWith = (apiKey: string): Send => {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    return (asked, signal) => client.beta.messages.stream(asked, { signal }).finalMessage();
};

const asked = (model: string, messages: MessageParam[]): Asked => ({
    model,
    // Thinking counts towards it, and a remark over a long passage is thought about at length.
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    // Where the model declines for its safeguards, the API asks the one it names for that case.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // The knowledge is the same for every remark and is kept from one to the next; the second
    // mark moves with the conversation, so that a turn after a trial reads the piece from the
    // cache as well.
    system: [{ type: 'text', text: KNOWLEDGE, cache_control: { type: 'ephemeral' } }],
    cache_control: { type: 'ephemeral' },
    tools: [{ ...TRY_STEPS, eager_input_streaming: true }],
    messages,
});

/**
 * One turn. A tool call's input arrives as it is written, and one that cannot be parsed at all
 * rejects the turn before there is a call to answer, as does a connection lost midway: the turn
 * is then asked again, twice at most. What the API itself refuses is not asked again.
 */
const oneTurn = async (send: Send, request: Asked, signal?: AbortSignal): Promise<Message> => {
    for (let again = 0; ; again++) {
        try {
            return await send(request, signal);
        } catch (thrown) {
            if (thrown instanceof APIError || signal?.aborted || again === 2) throw thrown;
        }
    }
};

const BEFORE_A_HANDOVER = new Set(['thinking', 'redacted_thinking', 'tool_use']);

/**
 * A turn as it is sent back: whole and unchanged, the thinking included, which the API checks.
 *
 * But for one case. Where the model that began the turn declined midway and another took over,
 * what the first thought and called before the handover is no part of what the second goes on
 * from, and the API refuses to be sent it; the mark of the handover stays where it stood.
 */
const sentBack = (content: ContentBlock[]): ContentBlock[] => {
    const handover = content.findLastIndex((block) => block.type === 'fallback');
    return content.filter(
        (block, index) => index >= handover || !BEFORE_A_HANDOVER.has(block.type),
    );
};

const reasonOf = (thrown: unknown, signal?: AbortSignal): ExpertFailure => {
    if (thrown instanceof APIUserAbortError || signal?.aborted) return 'stopped';
    if (thrown instanceof AuthenticationError || thrown instanceof PermissionDeniedError) {
        return 'key';
    }
    if (thrown instanceof RateLimitError || thrown instanceof OverloadedError) return 'busy';
    // An error that arrives inside a stream has no status to be classed by, only its type.
    if (thrown instanceof APIError) {
        if (thrown.type === 'authentication_error' || thrown.type === 'permission_error') {
            return 'key';
        }
        if (thrown.type === 'rate_limit_error' || thrown.type === 'overloaded_error') {
            return 'busy';
        }
    }
    return 'failed';
};

/** The conversation about one remark: turn by turn until the model answers and no longer tries. */
const converse = async (
    send: Send,
    model: string,
    request: ExpertRequest,
    signal?: AbortSignal,
    onProgress?: (line: string) => void,
): Promise<ExpertAnswer> => {
    const trial = trialOf(request, onProgress);
    let messages: MessageParam[] = [{ role: 'user', content: buildPrompt(request) }];
    onProgress?.('Reading the passage…');

    for (let turns = 0; turns < TURNS; turns++) {
        signal?.throwIfAborted();
        const message = await oneTurn(send, asked(model, messages), signal);
        // Before anything of it is read: a turn declined or cut off holds no answer, and a tool
        // call in it may be half written.
        if (message.stop_reason === 'refusal') throw new ExpertError('declined');
        if (message.stop_reason === 'max_tokens') throw new ExpertError('unreadable');

        const content = sentBack(message.content);
        const calls = content.filter((block) => block.type === 'tool_use');
        if (calls.length === 0) {
            const text = content.flatMap((block) => (block.type === 'text' ? block.text : []));
            const answer = readAnswer(text.join(''));
            if (!answer) throw new ExpertError('unreadable');
            return { ...answer, model: message.model };
        }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const { id, input } of calls) {
            const { content: result, failed } = await trial(input);
            results.push({
                type: 'tool_result',
                tool_use_id: id,
                content: result,
                ...(failed && { is_error: true }),
            });
        }
        signal?.throwIfAborted();
        messages = [
            ...messages,
            { role: 'assistant', content },
            { role: 'user', content: results },
        ];
        onProgress?.('Reading what the trial left…');
    }
    throw new ExpertError('unreadable');
};

/**
 * @param send how one request is sent; a test hands in a scripted one.
 * @param model the model asked. The one that answered is named in the answer.
 */
export const expertThrough = (send: Send, model: string): Expert => ({
    ask: async (request, { signal, onProgress } = {}) => {
        try {
            return await converse(send, model, request, signal, onProgress);
        } catch (thrown) {
            if (thrown instanceof ExpertError) throw thrown;
            throw new ExpertError(reasonOf(thrown, signal), { cause: thrown });
        }
    },
});
