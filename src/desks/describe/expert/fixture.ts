/**
 * For the tests: a request as the desk makes one, over the published transcription.
 */
import {
    bar,
    loadPublished,
    remark,
    step,
} from '../../../../tests/fitting/description/published';
import {
    describe as runDescription,
    type DescriptionRun,
    type Step,
} from '../../../fitting/description/index';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import type { Call } from '../../../model/Work';
import type { ExpertRequest, RemarkInWords } from './types';

export { bar, step };

export interface Fixture {
    /** The run of a document that holds the choice of take and no remark. */
    base: DescriptionRun;
    /** The calls of the published reconstruction, every one made by hand. */
    published: readonly Call[];
    /**
     * A request about `asked`, in a document that holds `others`, and `asked` itself where it
     * has become steps before. The document holds the choice of take besides, or the calls
     * handed in as `byHand`.
     */
    request: (
        asked: RemarkInWords,
        others?: readonly RemarkInWords[],
        more?: Partial<ExpertRequest>,
    ) => ExpertRequest;
}

/** What a remark is about. */
export const about = (
    kind: DescribedPlace['kind'],
    from = 0,
    to = 0,
    notes: string[] = [],
): DescribedPlace => ({ kind, from, to, notes });

export const said = (
    id: string,
    text: string,
    about: DescribedPlace,
    steps: Step[] = [],
): RemarkInWords => ({ id, text, about, steps });

export const loadFixture = (): Fixture => {
    const published = loadPublished();
    const document = (
        remarks: readonly RemarkInWords[],
        byHand: readonly Call[] = published.choice,
    ): Call[] => [
        ...byHand,
        ...remarks.map(({ id, text, about, steps }) => remark(id, [...steps], { text, about })),
    ];

    const base = runDescription(published.alignment, document([]));
    const { end } = base.roll;
    // A quarter of upbeat, then bars of four.
    const bars = [{ n: 0, from: 0, to: bar(1) }];
    for (let n = 1; bar(n) < end; n++) {
        bars.push({ n, from: bar(n), to: Math.min(bar(n + 1), end) });
    }

    return {
        base,
        published: published.work.provenance,
        request: (asked, others = [], more = {}) => {
            const standing = asked.steps.length > 0 ? [...others, asked] : others;
            const calls = document(standing, more.byHand);
            return {
                remark: asked,
                thread: [],
                others,
                run:
                    standing.length > 0 || more.byHand
                        ? runDescription(published.alignment, calls)
                        : base,
                piece: { title: published.work.name, ppq: 720, bars },
                tryOut: (steps) =>
                    Promise.resolve(
                        runDescription(published.alignment, calls, {
                            trial: { remark: asked.id, steps: [...steps] },
                        }),
                    ),
                ...more,
            };
        },
    };
};
