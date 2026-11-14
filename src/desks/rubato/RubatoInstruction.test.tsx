// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Instruction } from '../../fitting/instructions/index';
import { RubatoInstruction } from './RubatoInstruction';

afterEach(cleanup);

describe('a rubato on the plot', () => {
    /**
     * One line per onset the rubato moves, all of them under the one rubato. Keyed by the
     * rubato's date, every line but the first was a duplicate React warned about.
     */
    it('draws a line per onset without a duplicate key', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const rubato = { date: 0, frameLength: 2880, intensity: 1.2 } as Instruction<'rubato'>;

        const { container } = render(
            <svg>
                <RubatoInstruction
                    rubato={rubato}
                    onsetDates={[0, 720, 1440, 2160]}
                    stretchX={0.1}
                    height={100}
                    onClick={() => undefined}
                    active={false}
                    chords={new Map()}
                    play={() => undefined}
                    stop={() => undefined}
                />
            </svg>,
        );

        expect(container.querySelectorAll('line')).toHaveLength(4);
        const keyWarnings = error.mock.calls.filter((call) => String(call[0]).includes('same key'));
        error.mockRestore();
        expect(keyWarnings).toEqual([]);
    });
});
