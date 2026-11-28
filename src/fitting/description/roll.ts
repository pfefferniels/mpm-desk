/**
 * The roll: every note as it was played and as an MPM renders it, on the recording's clock.
 *
 * The rendering is the renderer's own performance, laid against the recording the way the chain
 * places a tempo: anew on the chord each `<tempo>` begins on, so that what one stretch gets wrong
 * is not carried into the next.
 */
import type { Alignment, AlignedNote } from '../alignment';
import type { Mpm } from '../instructions/index';
import { PULSES_PER_QUARTER, PULSES_PER_WHOLE } from '../ppq';
import type { DatedTimeSignature } from '../timeSignature';
import { coversDate, placeTempos } from '../transformers/tempo/placedTempos';
import { millisecondsAt } from '../transformers/tempo/tempoCalculations';
import { perform, type PedalKind, type Sounded } from './perform';

/** One note as recorded and as the MPM renders it (`mpm`), in ms from the first note. */
export interface RollNote extends Sounded {
    id: string;
    part: number;
    pitch: number;
    /** In ticks. */
    date: number;
    duration: number;
    /** The note before the corrections, where a `Modify` call changed it. */
    arrived?: Sounded;
    mpm: Sounded;
    /** Recorded less rendered: onset (ms), length (ms), velocity. */
    late: number;
    longMs: number;
    loud: number;
}

/** What a run assumed where nothing is described. */
export interface Assumed {
    tempo: { from: number; to: number; bpm: number }[];
    /** The level stated on `levelDates`, the median velocity; null where none could be assumed. */
    level: number | null;
    /** The dates the level is stated on: the first chord of every stretch without dynamics. */
    levelDates: number[];
}

export interface Roll {
    notes: RollNote[];
    /** Grace notes as recorded; the score gives them no date. */
    graces: {
        id: string;
        group: string;
        principal: string;
        pitch: number;
        ms: number;
        velocity: number;
    }[];
    /** The pedals as recorded and as rendered; `value` is of 127. */
    pedals: {
        played: { kind: PedalKind; ms: number; msEnd: number }[];
        mpm: { kind: PedalKind; ms: number; value: number }[];
    };
    /** The beats of the score, where the tempo map puts them. */
    beats: { date: number; ms: number }[];
    assumed: Assumed;
    /** The level a note is rendered at where no dynamics are described (velocity). */
    level: number;
    /** Where the score ends, in ticks. */
    end: number;
    timeSignatures: DatedTimeSignature[];
}

/** What a roll is laid out from. */
interface Run {
    /** The recording as the chain left it: on the chain's clock, less what the fitters explain. */
    fitted: Alignment;
    /** The recording as played, with only the corrections applied, on its own clock. */
    played: Alignment;
    /** Every note before the corrections, on the recording's own clock. */
    arrived: ReadonlyMap<string, Sounded>;
    /** How far the chain moved the recording to put its first onset at 0, in ms. */
    shifted: number;
    mpm: Mpm;
    /** The MPM and the score it is rendered against, as text. */
    xml: string;
    score: string | undefined;
    assumed: Assumed;
    level: number;
}

/** A note of the recording as it sounds. */
export const soundOf = (note: AlignedNote): Sounded => ({
    ms: note['milliseconds.date'],
    msEnd: note['milliseconds.date.end'],
    velocity: note.velocity,
});

/** The roll of a run: its MPM rendered, and laid against the recording as played. */
export const layRoll = ({
    fitted,
    played,
    arrived,
    shifted,
    mpm,
    xml,
    score,
    assumed,
    level,
}: Run): Roll => {
    const rendered = score === undefined ? { notes: [], pedals: [] } : perform(score, xml);
    const performed = new Map(rendered.notes.map((note) => [note.id, note]));
    const segments = placeTempos(fitted, mpm, 'global');
    const governing = (date: number) =>
        segments.find((segment) => coversDate(segment, date)) ?? segments[0];
    /** From the renderer's clock to the recording's, under the tempo governing a date. */
    const lead = (date: number) => {
        const segment = governing(date);
        return segment ? segment.startMs - segment.renderedStartMs : 0;
    };
    const onClock = ({ ms, msEnd, velocity }: Sounded): Sounded => ({
        ms: ms - shifted,
        msEnd: msEnd - shifted,
        velocity,
    });

    const asPlayed = new Map(played.allNotes.map((note) => [note['xml:id'], note]));
    const notes = fitted.allNotes.map((note): RollNote => {
        const id = note['xml:id'];
        const heard = asPlayed.get(id);
        // Not the chain's copy, for the playing: the fitters take what they explain out of it.
        const sounded = heard ? onClock(soundOf(heard)) : soundOf(note);
        const before = arrived.get(id);
        const original = before ? onClock(before) : sounded;
        const sounds = segments.length > 0 ? performed.get(id) : undefined;
        const rendering = sounds
            ? {
                  ms: lead(note.date) + sounds.ms,
                  msEnd: lead(note.date) + sounds.msEnd,
                  velocity: sounds.velocity,
              }
            : sounded;
        const changed =
            Math.abs(original.ms - sounded.ms) > 1e-6 ||
            Math.abs(original.msEnd - sounded.msEnd) > 1e-6 ||
            original.velocity !== sounded.velocity;
        return {
            id,
            part: note.part,
            pitch: note['midi.pitch'],
            date: note.date,
            duration: note.duration,
            ...sounded,
            ...(changed && { arrived: original }),
            mpm: rendering,
            late: sounded.ms - rendering.ms,
            longMs: sounded.msEnd - sounded.ms - (rendering.msEnd - rendering.ms),
            loud: sounded.velocity - rendering.velocity,
        };
    });

    const end = fitted.end;
    const clockAt = (date: number): number => {
        const segment = governing(date);
        return segment ? segment.startMs + millisecondsAt(date, segment.resolved) : date;
    };
    const beats: Roll['beats'] = [];
    fitted.timeSignatures.forEach((signature, i) => {
        const until = fitted.timeSignatures[i + 1]?.date ?? end;
        for (
            let date = signature.date;
            date < until;
            date += PULSES_PER_WHOLE / signature.denominator
        ) {
            beats.push({ date, ms: clockAt(date) });
        }
    });
    if (beats.length === 0) {
        for (let date = 0; date < end; date += PULSES_PER_QUARTER)
            beats.push({ date, ms: clockAt(date) });
    }
    beats.push({ date: end, ms: clockAt(end) });

    return {
        notes,
        graces: fitted.graces.map((grace) => ({
            id: grace['xml:id'],
            group: grace.group,
            principal: grace.principal,
            pitch: grace['midi.pitch'],
            ms: grace['milliseconds.date'],
            velocity: grace.velocity,
        })),
        pedals: {
            played: played.pedals
                .map((pedal) => ({
                    kind: pedal.type,
                    ms: pedal['milliseconds.date'] - shifted,
                    msEnd: pedal['milliseconds.date.end'] - shifted,
                }))
                .sort((a, b) => a.ms - b.ms),
            mpm: rendered.pedals
                .map(({ kind, date, ms, value }) => ({ kind, ms: lead(date) + ms, value }))
                .sort((a, b) => a.ms - b.ms),
        },
        beats,
        assumed,
        level,
        end,
        timeSignatures: fitted.timeSignatures,
    };
};
