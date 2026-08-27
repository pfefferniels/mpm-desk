/**
 * The reader's two directions agree: what is in effect at a date, and where an instruction
 * reaches. `reachOf` is what a chip on the narrative desk plays, `effectiveAt` is what lights
 * a word or a row as the playhead passes, and a listener would notice the two disagreeing —
 * a row lit for an instruction whose preview has already stopped.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPerformance, type Instruction } from './mpm';
import { readMeter } from './score';

const mpm = readPerformance(
    readFileSync('src/test/fixtures/performance.mpm', 'utf-8'),
    readMeter(readFileSync('src/test/fixtures/score.msm', 'utf-8')),
);

const byId = (id: string): Instruction => {
    const instruction = mpm.byId(id);
    if (!instruction) throw new Error(`${id} is no longer in the fixture`);
    return instruction;
};

describe('where an instruction reaches', () => {
    it('a tempo holds until the next tempo replaces it', () => {
        expect(mpm.reachOf(byId('tempo_0'))).toEqual({ from: 0, to: 720 });
    });

    it('a rubato reaches the end of its frame, unless the next rubato comes first', () => {
        // frameLength 720, the next rubato at 5760.
        expect(mpm.reachOf(byId('rubato_2880'))).toEqual({ from: 2880, to: 3600 });
    });

    it('an ornament acts on the notes at its own date and no further', () => {
        const [ornament] = mpm.ofType('ornament');
        expect(mpm.reachOf(ornament)).toEqual({ from: ornament.date, to: ornament.date });
    });

    it('the last of an unbounded kind holds to the end of the piece', () => {
        const tempi = mpm.ofType('tempo');
        const last = tempi[tempi.length - 1];
        expect(mpm.reachOf(last)).toEqual({ from: last.date, to: Infinity });
    });

    it('agrees with effectiveAt, for every instruction in the document', () => {
        expect(mpm.instructions.length).toBeGreaterThan(500);
        for (const instruction of mpm.instructions) {
            const { from, to } = mpm.reachOf(instruction);
            const { type } = instruction;
            expect(from).toBe(instruction.date);
            // In effect at its own date…
            expect(mpm.effectiveAt(from, type)).toContain(instruction);
            if (to === from) continue;
            // …still in effect just before it ends…
            expect(mpm.effectiveAt(Number.isFinite(to) ? to - 1 : from + 1, type)).toContain(instruction);
            // …and no longer at the end.
            if (Number.isFinite(to)) expect(mpm.effectiveAt(to, type)).not.toContain(instruction);
        }
    });
});
