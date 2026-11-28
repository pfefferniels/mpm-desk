/**
 * The published transcription as the Desk opens it: the alignment with its readings still side by
 * side, and the calls of the published reconstruction, the choice of take among them.
 */
import { readFileSync } from 'node:fs';
import { convertMeiToMsm } from 'espressivo';
import { asMSM } from '../../../src/fitting/asMSM';
import type { Alignment } from '../../../src/fitting/alignment';
import type { DescribeOptions } from '../../../src/fitting/transformers/index';
import type { DescriptionRun } from '../../../src/fitting/description/index';
import { parseWorkFile, type Call, type WorkFile } from '../../../src/model/Work';
import { publishedPath } from '../../../src/test/published';

export interface Published {
    alignment: Alignment;
    work: WorkFile;
    /** The calls a document holds before anything is said of it: the take that is read. */
    choice: Call[];
}

export const loadPublished = (): Published => {
    const mei = readFileSync(publishedPath('mei'), 'utf-8');
    const work = parseWorkFile(readFileSync(publishedPath('work'), 'utf-8'));
    const movement = convertMeiToMsm(mei)[0];
    if (!movement) throw new Error('the transcription holds no movement');
    return {
        alignment: asMSM(mei, movement.msm, movement.graces),
        work,
        choice: work.provenance.filter((call) => call.name === 'MakeChoice'),
    };
};

export const BAR = 2880;
/** The tick bar `n` begins on; the piece opens with an upbeat of a quarter. */
export const bar = (n: number) => 720 + (n - 1) * BAR;

type Steps = DescribeOptions['steps'];

/** A remark as a document holds it. */
export const remark = (id: string, steps: Steps, more: Partial<DescribeOptions> = {}): Call => ({
    id,
    name: 'Describe',
    options: {
        text: id,
        about: { kind: 'piece', from: 0, to: 0, notes: [] },
        model: null,
        date: null,
        steps,
        calls: [],
        ...more,
    },
});

export const step = (name: string, options: Record<string, unknown> = {}): Steps[number] => ({
    name,
    options,
});

const rms = (values: number[]) =>
    Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));

/** How far the chords were played from where the MPM has them, and the notes of a chord from one another, in ms. */
export const left = ({ roll }: DescriptionRun, from = -Infinity, to = Infinity) => {
    const notes = roll.notes.filter((note) => note.date >= from && note.date < to);
    const chords = Map.groupBy(notes, (note) => note.date);
    const means = new Map(
        [...chords].map(([date, chord]) => [
            date,
            chord.reduce((sum, note) => sum + note.late, 0) / chord.length,
        ]),
    );
    return {
        pulse: rms([...means.values()]),
        spread: rms(notes.map((note) => note.late - (means.get(note.date) ?? 0))),
        loud: rms(notes.map((note) => note.loud)),
    };
};
