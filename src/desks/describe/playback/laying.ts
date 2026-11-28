/**
 * A remark's passage as the MPM renders it, on the recording's clock: where its notes go on the
 * roll, and what the piano is handed.
 *
 * `bringOut` answers on the renderer's own clock. The roll has every note on the recording's: the
 * renderer's performance carried over tempo by tempo, anew on the chord each `<tempo>` begins on.
 * How far each tempo was carried is not handed to the page, so it is read off the plain
 * rendering: a note stands on the roll as far from where the renderer has it as its tempo was
 * carried, and the same note of another rendering of that MPM is carried as far.
 *
 * Carried so, a rendering whose tempo is exaggerated still runs on to wherever its own clock has
 * got to. So it is moved once more, as a whole, to where the first chord that is played stands on
 * the roll: what is heard is one stretch of one clock, and the roll shows each note where it
 * sounds.
 */
import type { BroughtOut, Roll, RollNote, Sounded } from '../../../fitting/description/client';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import { pedalled, pressesOf, struck, type Heard } from './hearing';
import { freshOf, playedFor, playedFrom, soundsOf, timesOf, type Wrote } from './passage';

type Performed = BroughtOut['notes'][number];

interface Laid {
    /** Every note of the rendering, carried as far as the roll carried it. */
    notes: ReadonlyMap<string, Sounded>;
    /** A moment of the rendering's own clock, carried as far as the note struck last before it. */
    moment: (ms: number) => number;
}

/**
 * A rendering carried onto the roll's clock, tempo by tempo.
 *
 * @param plain the MPM as it stands, on the renderer's clock: what the roll's notes were laid from.
 * @param out the rendering to lay, of the same MPM and on the same clock.
 */
export const lay = (
    notes: readonly RollNote[],
    plain: readonly Performed[],
    out: readonly Performed[],
): Laid => {
    const plainly = new Map(plain.map((note) => [note.id, note]));
    const performed = new Map(out.map((note) => [note.id, note]));
    const laid = new Map<string, Sounded>();
    const carried: { ms: number; by: number }[] = [];
    for (const note of notes) {
        const sounds = performed.get(note.id);
        const stood = plainly.get(note.id);
        if (!sounds || !stood) continue;
        const by = note.mpm.ms - stood.ms;
        laid.set(note.id, {
            ms: sounds.ms + by,
            msEnd: sounds.msEnd + by,
            velocity: sounds.velocity,
        });
        carried.push({ ms: sounds.ms, by });
    }
    carried.sort((a, b) => a.ms - b.ms);
    return {
        notes: laid,
        moment: (ms) => ms + ((carried.findLast((note) => note.ms <= ms) ?? carried[0])?.by ?? 0),
    };
};

/** A remark as it is played. */
export interface Rendering {
    /** Every note where the rendering has it, in ms of the recording; null as the MPM stands. */
    moved: ReadonlyMap<string, Sounded> | null;
    heard: Heard;
    /** The stretch that is played, in ms of the recording. */
    from: number;
    until: number;
}

/**
 * A remark's passage, with as much around it as it takes to hear what the remark says.
 *
 * @param line where a remark on the whole piece is played from, in ms of the recording.
 * @param brought the MPM rendered as it stands and with the remark's instructions brought out,
 * both on the renderer's clock; null to play the passage as the MPM has it.
 * @returns null where there is nothing to play.
 */
export const renderingOf = (
    roll: Roll,
    place: DescribedPlace,
    wrote: Wrote,
    line: number,
    brought: { plain: BroughtOut; out: BroughtOut } | null,
): Rendering | null => {
    const laid = brought && lay(roll.notes, brought.plain.notes, brought.out.notes);
    const carried = (note: RollNote) => laid?.notes.get(note.id) ?? note.mpm;
    const chosen =
        place.kind === 'piece'
            ? playedFrom(roll, line)
            : playedFor(roll, place, wrote, (note) => carried(note).ms);
    if (!chosen) return null;

    const fresh = freshOf(roll.notes, chosen);
    const first = Math.min(...fresh.map((note) => note.date));
    const opening = fresh.filter((note) => note.date === first);
    const shift =
        Math.min(...opening.map((note) => note.mpm.ms)) -
        Math.min(...opening.map((note) => carried(note).ms));
    const moved = new Map(
        roll.notes.map((note): [string, Sounded] => {
            const at = laid?.notes.get(note.id);
            return [
                note.id,
                at
                    ? { ms: at.ms + shift, msEnd: at.msEnd + shift, velocity: at.velocity }
                    : note.mpm,
            ];
        }),
    );
    const soundOf = (note: RollNote) => moved.get(note.id) ?? note.mpm;
    const { from, until } = timesOf(
        fresh.map(soundOf),
        fresh.filter((note) => chosen.own.has(note.id)).map(soundOf),
    );
    return {
        moved: laid ? moved : null,
        heard: {
            notes: struck(soundsOf(roll.notes, soundOf, chosen)),
            pedals:
                laid && brought
                    ? pressesOf(
                          brought.out.pedal.map(({ ms, value }) => ({
                              ms: laid.moment(ms) + shift,
                              value,
                          })),
                          until,
                      )
                    : pedalled(roll, 'rendered'),
        },
        from,
        until,
    };
};
