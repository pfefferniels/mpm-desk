/**
 * The expert of the describe desk: what turns a remark in words into steps.
 */
import { ExpertError } from './failure';
import type { Expert } from './types';

export type { Expert, ExpertAnswer, ExpertFailure, ExpertRequest, RemarkInWords } from './types';
export { ExpertError } from './failure';
export { useExpertKey } from './key';

export const EXPERT_MODEL = 'claude-opus-5-5';

/**
 * The expert asked with the reader's own key.
 *
 * Nothing is loaded, and nothing sent, before the first question.
 */
export const createExpert = (apiKey: string): Expert => {
    let loading: Promise<Expert> | undefined;
    return {
        ask: async (request, options) => {
            if (!apiKey.trim()) throw new ExpertError('key');
            loading ??= import('./anthropic').then(({ expertThrough, senderWith }) =>
                expertThrough(senderWith(apiKey.trim()), EXPERT_MODEL),
            );
            let expert: Expert;
            try {
                expert = await loading;
            } catch (cause) {
                // Not kept: a connection that was down for the first question may be up again.
                loading = undefined;
                throw new ExpertError('failed', { cause });
            }
            return expert.ask(request, options);
        },
    };
};
