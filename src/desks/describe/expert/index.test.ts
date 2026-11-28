import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExpert, EXPERT_MODEL, ExpertError } from './index';
import type { ExpertRequest } from './types';

/**
 * The expert as the desk makes one: that nothing is loaded before it is asked, that it is asked
 * with the key it was made with, and that no key is no question.
 */

const mocks = vi.hoisted(() => ({
    loaded: vi.fn(),
    senderWith: vi.fn((key: string) => `a sender with ${key}`),
    ask: vi.fn(),
    expertThrough: vi.fn(),
}));

vi.mock('./anthropic', () => {
    mocks.loaded();
    return { senderWith: mocks.senderWith, expertThrough: mocks.expertThrough };
});

const REQUEST = { remark: { id: 'asked' } } as ExpertRequest;
const ANSWER = { steps: [], question: 'Which chord?', model: EXPERT_MODEL };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ask.mockResolvedValue(ANSWER);
    mocks.expertThrough.mockReturnValue({ ask: mocks.ask });
});

describe('createExpert', () => {
    it('asks nothing without a key, and says that the key is why', async () => {
        for (const key of ['', '   ']) {
            const asking = createExpert(key).ask(REQUEST);
            await expect(asking).rejects.toBeInstanceOf(ExpertError);
            await expect(asking).rejects.toMatchObject({ reason: 'key' });
        }
        expect(mocks.senderWith).not.toHaveBeenCalled();
    });

    it('loads what asks with the first question, and once', async () => {
        const expert = createExpert(' sk-ant-mine ');
        expect(mocks.loaded).not.toHaveBeenCalled();
        expect(mocks.senderWith).not.toHaveBeenCalled();

        const options = { onProgress: vi.fn() };
        expect(await expert.ask(REQUEST, options)).toBe(ANSWER);
        expect(await expert.ask(REQUEST)).toBe(ANSWER);

        expect(mocks.loaded).toHaveBeenCalledTimes(1);
        expect(mocks.senderWith).toHaveBeenCalledExactlyOnceWith('sk-ant-mine');
        expect(mocks.expertThrough).toHaveBeenCalledExactlyOnceWith(
            'a sender with sk-ant-mine',
            'claude-opus-5-5',
        );
        expect(mocks.ask).toHaveBeenNthCalledWith(1, REQUEST, options);
        expect(mocks.ask).toHaveBeenNthCalledWith(2, REQUEST, undefined);
    });

    it('fails where what asks cannot be made, and tries to make it again when asked again', async () => {
        mocks.senderWith.mockImplementationOnce(() => {
            throw new Error('no network to load it over');
        });
        const expert = createExpert('sk-ant-mine');
        await expect(expert.ask(REQUEST)).rejects.toMatchObject({ reason: 'failed' });
        expect(await expert.ask(REQUEST)).toBe(ANSWER);
    });

    it('lets through why the expert gave no answer', async () => {
        mocks.ask.mockRejectedValue(new ExpertError('busy'));
        await expect(createExpert('sk-ant-mine').ask(REQUEST)).rejects.toMatchObject({
            reason: 'busy',
        });
    });
});
