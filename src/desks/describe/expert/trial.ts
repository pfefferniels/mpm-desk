/**
 * The expert's one tool: its steps tried on the roll, and what came of them.
 */
import type { DescriptionRun, Step, StepReport } from '../../../fitting/description/client';
import { asStep } from './answer';
import { idsOf, leftIn, measures } from './left';
import { placesOf } from './places';
import type { ExpertRequest } from './types';

/** How often a remark's steps may be tried before it is answered. */
export const TRIES = 3;
/** How many of a step's elements, and of its fitted lines, a report holds. */
const ELEMENTS = 8;
const FITTED = 48;

/** The tool as the API is told of it. */
export const TRY_STEPS = {
    name: 'try_steps',
    description:
        "Runs the document with your steps in place of this remark's, keeping nothing. Returns per step an error, or what it wrote (counts by MPM element, and the first elements themselves with their fitted attributes), what a fitted step read off the recording, and why what it came to is withheld from the document where it is; then pulse_ms, spread_ms, velocity and length_ms left in the passage and in the piece, before and after. Call it with the steps you intend before you answer, three times at most.",
    input_schema: {
        type: 'object' as const,
        properties: {
            steps: {
                type: 'array',
                description: 'The steps, each {name, options}',
                items: { type: 'object' },
            },
        },
        required: ['steps'],
    },
};

/** What the tool answers: the text of its result, and whether that is an error. */
interface Trial {
    content: string;
    failed: boolean;
}

/** The steps of a tool input, or `undefined` where it is not `{steps: [{name, options}]}`. */
const stepsOf = (input: unknown): Step[] | undefined => {
    const stated = (input as { steps?: unknown } | null)?.steps;
    if (!Array.isArray(stated)) return undefined;
    const steps = stated.flatMap((step) => asStep(step) ?? []);
    return steps.length === stated.length ? steps : undefined;
};

/** The MPM elements a step wrote, counted by their tag. */
const kinds = ({ elements, written }: StepReport): string[] => {
    const counts = new Map<string, number>();
    elements.forEach((id, index) => {
        const kind =
            /^<([\w.:-]+)/.exec(written[index] ?? '')?.[1] ??
            /^[A-Za-z]+/.exec(id)?.[0] ??
            'element';
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    });
    return [...counts].map(([kind, count]) => `${kind} x${count}`);
};

/** The first elements a step wrote, as they stand in the MPM, and the definitions they name. */
const shown = ({ written, definitions }: StepReport): string[] => {
    const first = written.filter(Boolean).slice(0, ELEMENTS);
    const named = new Set(first.flatMap((tag) => /\sname\.ref="([^"]+)"/.exec(tag)?.[1] ?? []));
    const defined = definitions.filter((definition) =>
        named.has(/\sname="([^"]+)"/.exec(definition)?.[1] ?? ''),
    );
    return [...first, ...defined.slice(0, ELEMENTS)];
};

/** What a fitted step read off the recording over one span, in a line. */
const fittedLine = (
    { from, to, bpm, transitionTo, onsets, rmsMs, volume, chords }: Record<string, unknown>,
    place: (tick: number) => string,
): string => {
    const number = (value: unknown) => (typeof value === 'number' ? value : NaN);
    const span = `${place(number(from))}–${place(number(to))}`;
    if (typeof bpm !== 'number') {
        return `${span}  level ${number(volume).toFixed(1)} over ${number(chords)} chords`;
    }
    const arriving = typeof transitionTo === 'number' ? ` → ${transitionTo.toFixed(1)}` : '';
    return `${span}  ${bpm.toFixed(1)}${arriving} bpm, ${number(onsets)} chords, rms ${number(rmsMs).toFixed(0)} ms`;
};

/** What a trial says of one step: why it did not run, or what it wrote. */
interface StepTried {
    step: number;
    name: string;
    error?: string;
    /** The elements it wrote, counted by kind: "tempo x4". */
    wrote?: string[];
    /** The first of them as they stand in the MPM, then the definitions those name. */
    written?: string[];
    written_shown?: string;
    fitted?: string[];
    fitted_shown?: string;
    fitted_to_notes?: number;
    withheld?: string;
}

const stepTried = (
    step: number,
    name: string,
    report: StepReport | undefined,
    place: (tick: number) => string,
): StepTried => {
    if (!report) return { step, name, error: 'the run says nothing of this step' };
    if (report.error !== undefined) return { step, name, error: report.error };
    const { elements, fitted, evidence, withheld } = report;
    return {
        step,
        name,
        wrote: kinds(report),
        written: shown(report),
        ...(elements.length > ELEMENTS && {
            written_shown: `${ELEMENTS} of ${elements.length} elements, with the definitions they name`,
        }),
        ...(fitted.length > 0 && {
            fitted: fitted.slice(0, FITTED).map((line) => fittedLine(line, place)),
        }),
        ...(fitted.length > FITTED && { fitted_shown: `${FITTED} of ${fitted.length}` }),
        fitted_to_notes: evidence.length,
        ...(withheld !== undefined && { withheld }),
    };
};

/**
 * What came of a trial: per step what it wrote or why it did not run, and the four measures of
 * the remark's passage and of the piece, as the document stands and as the trial leaves them.
 *
 * @param tried the document run with `steps` in place of the remark's own.
 */
export const reportOf = (
    { remark, run, piece }: ExpertRequest,
    steps: readonly Step[],
    tried: DescriptionRun,
) => {
    const reports = tried.remarks.find(({ id }) => id === remark.id)?.steps ?? [];
    const { place } = placesOf(piece, tried.roll.timeSignatures);
    const ids = idsOf(remark.about, run.roll.notes);
    const left = (of?: readonly string[]) => ({
        before: measures(leftIn(run.roll.notes, of)),
        after: measures(leftIn(tried.roll.notes, of)),
    });
    return {
        steps: steps.map(({ name }, index) => stepTried(index, name, reports[index], place)),
        left_in_passage: left(ids),
        left_in_piece: left(),
    };
};

/**
 * The tool for one remark. It counts its tries: what is asked beyond them is refused, so that a
 * remark is answered and not fitted to the last millisecond.
 */
export const trialOf = (request: ExpertRequest, onProgress?: (line: string) => void) => {
    let tries = 0;
    return async (input: unknown): Promise<Trial> => {
        const steps = stepsOf(input);
        if (!steps) {
            // The form the API's guide gives for an input that could not be read, which the
            // model takes as its cue to write it again.
            const content = JSON.stringify({ INVALID_JSON: JSON.stringify(input ?? null) });
            return { content, failed: true };
        }
        if (tries === TRIES) {
            return {
                content: `try_steps has been used ${TRIES} times for this remark, and that is all it may be. Answer now, with the steps that say what the reader said.`,
                failed: true,
            };
        }
        tries++;
        const count = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
        onProgress?.(`Trying ${count} on the roll…`);
        try {
            return {
                content: JSON.stringify(reportOf(request, steps, await request.tryOut(steps))),
                failed: false,
            };
        } catch (thrown) {
            const why = thrown instanceof Error ? thrown.message : String(thrown);
            return { content: `The steps could not be tried: ${why}`, failed: true };
        }
    };
};
