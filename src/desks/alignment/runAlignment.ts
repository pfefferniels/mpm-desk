import type { MidiFile } from 'midifile-ts';
import {
    alignScoreToPerformance,
    hasRepeatSigns,
    hasUntimedGraceNotes,
    unshowableScoreIds,
    type AlignProgress,
    type AlignResult,
} from '../../alignment/mlign';
import type { MlignModelId } from '../../alignment/mlign/models';
import { asSpans, type NoteSpan } from '../../performance/midiSpans';
import { getNotesFromMEI, type ScoreNote } from '../../score/scoreNotes';

/**
 * One run of the model, from reading the score to the three lists and what has to be said about
 * them.
 *
 * Lifted out of the component because none of it is a component's business: it reads two
 * documents, runs a model over them and reports. What is left in the desk is the toolbar, the
 * score and the popover.
 */

/**
 * How far along the whole job each stage is, so that the bar moves even though only the model
 * stage can say anything about its own progress.
 */
const STAGE_PERCENT = {
    score: 8,
    featurizing: 18,
    loading: 30,
    running: 45,
    decoding: 88,
    rendering: 94,
} as const;

type Stage = keyof typeof STAGE_PERCENT;

export interface Status {
    text: string;
    percent: number;
}

/** The stage after this one, for interpolating within a stage. */
const nextPercent = (stage: Stage): number => {
    const stages = Object.keys(STAGE_PERCENT) as Stage[];
    const next = stages[stages.indexOf(stage) + 1];
    return next ? STAGE_PERCENT[next] : 100;
};

/**
 * How long the score may take verovio to read before the run gives up on it.
 *
 * Nothing has been seen to come near this: a document verovio cannot lay out comes back in
 * milliseconds, and the flagship score reads in about a second. It is here so that a document
 * which did take for ever could not leave the desk busy with no way out.
 */
const SCORE_READ_TIMEOUT_MS = 120_000;

const withTimeout = async <T>(work: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(message));
        }, ms);
    });

    try {
        return await Promise.race([work, limit]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * The notes of the score, or a sentence saying why there are none.
 *
 * Verovio does not fail on a document it cannot make sense of: `loadData` returns false and
 * `renderToTimemap` hands back an empty object instead of a list, which `getNotesFromMEI` then
 * walks into a `TypeError`. That does reach the caller — but "timemap is not iterable" tells the
 * person who chose the file nothing at all, so it is turned into something they can act on and the
 * original is left in the console for whoever is debugging.
 */
export const readScore = async (mei: string): Promise<ScoreNote[]> => {
    // Both options are what the model was trained against: partitura keeps a unison written in two
    // voices as two notes, and the onsets it reads are the notated ones, not the ones verovio
    // would play an arpeggio or a grace note at.
    const reading = getNotesFromMEI(mei, {
        collapseUnisons: false,
        notatedOnsets: true,
    }).catch((cause: unknown) => {
        console.warn('Alignment: verovio could not read this score', cause);
        throw new Error(
            'That score could not be read as music. The file is XML, but the notation in it ' +
                'could not be laid out — check that it opens in another MEI viewer.',
        );
    });

    return withTimeout(
        reading,
        SCORE_READ_TIMEOUT_MS,
        'This score is taking too long to read. It may be far larger than the browser can lay ' +
            'out, or the file may be damaged.',
    );
};

export interface AlignmentRun {
    result: AlignResult;
    scoreNotes: ScoreNote[];
    spans: NoteSpan[];
    /** Matches the model found in a passage the engraving cannot show. */
    hidden: Set<string>;
    /** What is worth saying about the run, in the reader's own terms. */
    notices: string[];
}

export interface RunOptions {
    mei: string;
    midi: MidiFile;
    model: MlignModelId;
    allowMismatch?: boolean;
    onStatus: (status: Status) => void;
}

/**
 * What the run has to say about the score it was given, beyond the alignment itself.
 *
 * All of it is about the *engraving* rather than the model: a repeat written with signs is played
 * twice and drawn once, a grace note the encoding does not time is aligned from where verovio
 * would play it. Left unsaid, each shows up as the model having done something strange.
 */
const noticesFor = (mei: string, result: AlignResult, unshowable: ReadonlySet<string>): string[] => {
    const messages: string[] = [];

    if (unshowable.size > 0) {
        messages.push(
            `${String(unshowable.size)} notes of a repeated passage were aligned but cannot be ` +
                `shown. The score writes the repeat with repeat signs, so it is engraved once; ` +
                `only the first time through can be drawn.`,
        );
    } else if (hasRepeatSigns(mei)) {
        messages.push(
            `This score has repeat signs and is not written out. The repeats are not unfolded, ` +
                `so everything the performer played on a repeat is reported as an extra note.`,
        );
    }
    if (hasUntimedGraceNotes(mei)) {
        messages.push(
            `This score writes grace notes but records nothing about where they fall in the ` +
                `notation, so they are aligned from the moment verovio would play them — just ` +
                `before the beat they lean on — rather than from the beat itself.`,
        );
    }
    if (result.stats.skippedScoreNotes > 0) {
        messages.push(
            `${String(result.stats.skippedScoreNotes)} notes in the score have no pitch this ` +
                `aligner could read and were left out of the alignment.`,
        );
    }
    if (result.stats.skippedPerformedNotes > 0) {
        messages.push(
            `${String(result.stats.skippedPerformedNotes)} notes in the MIDI file have no ` +
                `readable pitch or time and were left out of the alignment.`,
        );
    }

    return messages;
};

/**
 * Align one score against one performance.
 *
 * Throws what it cannot handle — including `MismatchedPairError`, which is a *judgement* the
 * reader is allowed to overrule with `allowMismatch` rather than a failure they can do nothing
 * about. The caller decides which of the two it is showing.
 */
export const runAlignment = async ({
    mei,
    midi,
    model,
    allowMismatch,
    onStatus,
}: RunOptions): Promise<AlignmentRun> => {
    const at = (stage: Stage, text: string, within = 0) =>
        onStatus({
            text,
            percent: STAGE_PERCENT[stage] + within * (nextPercent(stage) - STAGE_PERCENT[stage]),
        });

    at('score', 'Reading the score…');
    // Verovio reads the whole score in one synchronous stretch, so the status line has to reach
    // the screen before it starts
    await new Promise((resolve) => setTimeout(resolve, 0));

    const scoreNotes = await readScore(mei);
    const spans = asSpans(midi, true).filter((span): span is NoteSpan => span.type === 'note');

    const onProgress = (progress: AlignProgress) => {
        if (progress.stage === 'running') {
            const done = progress.done ?? 0;
            const total = progress.total ?? 1;
            at(
                'running',
                total > 1
                    ? `Running the model, passage ${String(Math.min(done + 1, total))} of ${String(total)}…`
                    : 'Running the model…',
                total > 0 ? done / total : 0,
            );
        } else if (progress.stage === 'loading') {
            at('loading', 'Loading the alignment model (3 MB)…');
        } else if (progress.stage === 'featurizing') {
            at('featurizing', 'Preparing the notes…');
        } else {
            at('decoding', 'Working out the alignment…');
        }
    };

    const result = await alignScoreToPerformance(scoreNotes, spans, {
        model,
        onProgress,
        allowMismatch,
    });

    // Verovio reads a repeat written with repeat signs as two passes and mints an id for the
    // second one, which the document does not hold and the engraving never shows. Those notes are
    // worth aligning — they really were played — but their matches cannot be written into the MEI.
    const hidden = unshowableScoreIds(mei, result.matches);

    at('rendering', 'Drawing the score…');

    return { result, scoreNotes, spans, hidden, notices: noticesFor(mei, result, hidden) };
};
