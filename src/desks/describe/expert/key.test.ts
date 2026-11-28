import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the reader's key is kept: in the browser's storage where there is one, and for the visit
 * where there is none. The hook is loaded anew for every test, as it is for every visit.
 */

const STORED_AS = 'mpm-desk.expert-key';

const visit = async () => (await import('./key')).useExpertKey;

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('with storage', () => {
    it('has no key before one is set', async () => {
        const { result } = renderHook(await visit());
        expect(result.current[0]).toBeNull();
    });

    it('keeps a key that is set, and has it on the next visit', async () => {
        const first = renderHook(await visit());
        act(() => first.result.current[1]('  sk-ant-mine \n'));
        expect(first.result.current[0]).toBe('sk-ant-mine');
        expect(localStorage.getItem(STORED_AS)).toBe('sk-ant-mine');

        vi.resetModules();
        const next = renderHook(await visit());
        expect(next.result.current[0]).toBe('sk-ant-mine');
    });

    it('forgets a key set to nothing', async () => {
        localStorage.setItem(STORED_AS, 'sk-ant-old');
        const { result } = renderHook(await visit());
        expect(result.current[0]).toBe('sk-ant-old');

        act(() => result.current[1](null));
        expect(result.current[0]).toBeNull();
        expect(localStorage.getItem(STORED_AS)).toBeNull();

        act(() => result.current[1]('sk-ant-new'));
        act(() => result.current[1]('   '));
        expect(result.current[0]).toBeNull();
        expect(localStorage.getItem(STORED_AS)).toBeNull();
    });

    it('tells everything that reads the key when it changes', async () => {
        const useExpertKey = await visit();
        const [setting, showing] = [renderHook(useExpertKey), renderHook(useExpertKey)];
        act(() => setting.result.current[1]('sk-ant-mine'));
        expect(showing.result.current[0]).toBe('sk-ant-mine');
    });
});

describe('with storage that refuses', () => {
    beforeEach(() => {
        const refuse = () => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        };
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
    });

    it('has no key, and does not fail for it', async () => {
        const { result } = renderHook(await visit());
        expect(result.current[0]).toBeNull();
    });

    it('holds a key for the visit: for the desk mounted again, and until it is forgotten', async () => {
        const useExpertKey = await visit();
        const first = renderHook(useExpertKey);
        act(() => first.result.current[1]('sk-ant-mine'));
        expect(first.result.current[0]).toBe('sk-ant-mine');

        first.unmount();
        const again = renderHook(useExpertKey);
        expect(again.result.current[0]).toBe('sk-ant-mine');

        act(() => again.result.current[1](null));
        expect(again.result.current[0]).toBeNull();
    });
});
