/**
 * What the expert writes, read back: steps, and the one JSON object its answer is.
 */
import type { Step } from '../../../fitting/description/client';
import type { ExpertAnswer } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** A step as it was written, or `undefined` where it has no name or its options are no object. */
export const asStep = (value: unknown): Step | undefined => {
    if (!isRecord(value) || typeof value['name'] !== 'string') return undefined;
    const options = value['options'] ?? {};
    return isRecord(options) ? { name: value['name'], options } : undefined;
};

/**
 * The answer in a text that may hold more than the answer.
 *
 * The object is asked for alone, but a model that has just tried its steps may lead up to it in
 * words, or fence it: so the last `{"steps"` object is tried first, then whatever stands in a
 * fence, then everything between the first brace and the last.
 *
 * @returns `undefined` where no object with `steps` or a `question` can be read.
 */
export const readAnswer = (text: string): Omit<ExpertAnswer, 'model'> | undefined => {
    const candidates: string[] = [];
    const last = text.lastIndexOf('}');
    const tail = text.lastIndexOf('{"steps"');
    if (tail !== -1 && last > tail) candidates.push(text.slice(tail, last + 1));
    for (const [, fenced] of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
        candidates.push(fenced!);
    }
    const first = text.indexOf('{');
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

    for (const candidate of candidates) {
        let value: unknown;
        try {
            value = JSON.parse(candidate);
        } catch {
            continue;
        }
        if (!isRecord(value) || !('steps' in value || 'question' in value)) continue;
        const { steps, question } = value;
        // A question is asked before anything is written: the steps wait for its answer.
        if (typeof question === 'string' && question.trim()) {
            return { steps: [], question: question.trim() };
        }
        return {
            steps: (Array.isArray(steps) ? steps : []).flatMap((step) => asStep(step) ?? []),
            question: null,
        };
    }
    return undefined;
};
