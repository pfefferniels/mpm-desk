import type { CallOutcome } from '../fitting/fit';
import { getInstructions, type Mpm } from '../fitting/instructions/index';
import type { Call } from '../model/Work';

/**
 * A chain for a performance no test has fitted: one call per instruction, answerable for that
 * instruction alone and placed at its date.
 *
 * Which call wrote what is something only a run of the chain can say, and the fixture MPM comes
 * without its chain. One call per element is the plainest attribution that is still one, which is
 * all the selection, the follow and the markup desk need of it: every instruction answers to a
 * call, and no two calls answer for the same instruction.
 */
export const oneCallPerInstruction = (mpm: Mpm): { calls: Call[]; outcomes: CallOutcome[] } => {
    const named = getInstructions(mpm).filter(
        (instruction): instruction is typeof instruction & { id: string } =>
            instruction.id !== undefined,
    );
    const calls: Call[] = named.map((instruction) => ({
        id: `call:${instruction.id}`,
        name: `Insert:${instruction.type}`,
        options: {},
        elements: [instruction.id],
        range: { from: instruction.date, to: null },
    }));
    const outcomes: CallOutcome[] = calls.map((call) => ({
        id: call.id,
        elements: call.elements ?? [],
        range: call.range ?? null,
        evidence: [],
    }));
    return { calls, outcomes };
};
