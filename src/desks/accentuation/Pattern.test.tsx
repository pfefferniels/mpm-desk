/**
 * Where the desk draws a pattern's beats, against where espressivo sounds them.
 *
 * The renderer counts a pattern from the date of the time signature in force, in steps of the
 * pattern's own length — never from the instruction's `@date` (issue #47). The drawing used to
 * count from `@date`, which agrees only where the two grids coincide.
 */
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { Instruction } from '../../fitting/instructions/index';
import type { DatedTimeSignature } from '../../fitting/timeSignature';
import { Pattern } from './Pattern';
import type { Accentuation } from './AccentuationDesk';

const QUARTER = 720;
/** One quarter of anacrusis, then common time: the shipped score's map. */
const COMMON_TIME: DatedTimeSignature = { date: QUARTER, numerator: 4, denominator: 4 };

const accentuation = (beat: number): Accentuation => ({
    beat,
    value: beat === 1 ? 1 : 0,
    transitionFrom: beat === 1 ? 1 : 0,
    transitionTo: beat === 1 ? 1 : 0,
});

/** A four-beat pattern starting at `date`, its beats one quarter apart. */
const pattern = (date: number) =>
    ({
        type: 'accentuationPattern',
        date,
        scale: 20,
        length: 4,
        children: [1, 2, 3, 4].map(accentuation),
        accentuationPatternDefName: 'metre',
        id: 'ap',
    }) as unknown as Instruction<'accentuationPattern'> & {
        length: number;
        children: Accentuation[];
    };

/** The tick each accentuation is drawn at, read back off the lines. */
const drawnAt = async (date: number) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <svg>
                <Pattern
                    pattern={pattern(date)}
                    stretchX={1}
                    stretchY={10}
                    getScreenY={(velocity) => (1 - velocity) * 10 + 100}
                    signature={COMMON_TIME}
                    selected={false}
                />
            </svg>,
        );
    });
    const ticks = [...container.querySelectorAll('line')].map((line) => Number(line.getAttribute('x1')));
    act(() => {
        root.unmount();
    });
    container.remove();
    return ticks;
};

describe('a pattern is drawn on the grid it is read on', () => {
    it('draws a cell on the grid where it has always drawn it', async () => {
        // 720 is the downbeat the 4/4 takes effect on, so the pattern's own date is on the grid
        // and the beats fall a quarter apart from there.
        expect(await drawnAt(720)).toEqual([720, 1440, 2160, 2880]);
    });

    it('draws a bar-length cell a bar later at the next cycle', async () => {
        expect(await drawnAt(3600)).toEqual([3600, 4320, 5040, 5760]);
    });

    it('draws a cell off the grid where it sounds, not where its box starts', async () => {
        // Fitted at 2880 — a bar counted from tick 0, ignoring the anacrusis. The renderer counts
        // from 720 in steps of 2880, so the first thing this pattern does at 2880 is sound beat 4
        // of the cycle already running, and its own beat 1 does not come round until 3600.
        expect(await drawnAt(2880)).toEqual([3600, 4320, 5040, 2880]);
    });
});
