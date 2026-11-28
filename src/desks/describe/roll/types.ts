import type { StaffName } from './staff';

/**
 * What the roll is handed, and what it hands back.
 *
 * Everything is stated on the two clocks the desk has: **ticks** for the score (`date`,
 * `duration`, a remark's `from` and `to`) and **milliseconds of the recording** for everything
 * that sounded (`ms`, `msEnd`). The roll never converts one into the other except through
 * `beats`, which is the tempo so far saying where each beat of the score falls.
 */

/** One sounding of a note: when it began, when it ended, how hard it was struck. */
export interface Sounded {
    ms: number;
    msEnd: number;
    velocity: number;
}

export interface RollNote {
    id: string;
    part: number;
    staff: StaffName;
    /** MIDI pitch, and how it is spelled. */
    pitch: number;
    letter: string;
    alter: number;
    /** Ticks. */
    date: number;
    duration: number;
    /** The recording, as corrected: the shadow. */
    played: Sounded;
    /** What the MPM so far renders, on the recording's clock: the note. */
    rendered: Sounded;
    /** What the roll had before a correction. */
    arrived?: Sounded;
}

/** A grace note as it was recorded; the score gives it neither a date nor a spelling. */
export interface RollGrace {
    id: string;
    pitch: number;
    staff: StaffName;
    ms: number;
}

export type PedalKind = 'sustain' | 'soft';

export interface RollPedals {
    /** The presses as they were recorded. */
    played: readonly { kind: PedalKind; ms: number; msEnd: number }[];
    /** The moves the MPM's rendering makes; `value` is 0–127 and holds until the next move. */
    rendered: readonly { kind: PedalKind; ms: number; value: number }[];
}

/** What a remark is about. `from` and `to` are ticks, `to` exclusive. */
export interface About {
    kind: 'piece' | 'span' | 'notes' | 'box' | 'arrow';
    from: number;
    to: number;
    /** A set's or a box's notes; an arrow's two, the earlier first. */
    notes: string[];
}

export type RemarkState = 'done' | 'pending' | 'question' | 'trouble' | 'muted';

export interface RollRemark {
    id: string;
    text: string;
    about: About;
    state: RemarkState;
}

export interface RollView {
    /** On the grand staff, or key by key. */
    staff: boolean;
    /** Whether the notes as played stand behind the notes as rendered. */
    shadows: boolean;
    /** How much taller a louder note is drawn; 1 is the prototype's own. */
    loudnessGain: number;
}
