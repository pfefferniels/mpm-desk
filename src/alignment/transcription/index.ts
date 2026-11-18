/**
 * Everything the performer did differently, written into the score in one pass.
 *
 * The alignment says which played notes have no written note, which written notes went
 * unplayed, and which were played at another pitch. This reads each of them rhythmically and by
 * pitch and writes the answer into the document as a performance reading, so that the score
 * the rest of the app works on is the score that was played. Nobody is asked first. What a
 * reader decides comes afterwards, and is a correction: this figure is grace notes, that one a
 * trill sign, this one should not be in the score at all.
 *
 * The reading of an added note is a small exercise in rhythm transcription, and `./quantise`
 * says how it is done and after whom. The rest is notation: which staff and which of its voices
 * (`./place`), what the pitch is called (`./spell`), and how the answer is written without
 * moving a single note that was already there (`./write`).
 *
 * The transcription is a function of the source score, the alignment and the reader's choices,
 * and of nothing else. So a change of mind is not a patch: the document is taken back to its
 * source and transcribed again.
 */

import type { NoteSpan } from "../../performance/midiSpans";
import type { Divergence } from "../divergences";
import { kindOf, SIGN_KINDS, signFor, signOf, type SignKind } from "./figure";
import { UNITS, levelOf } from "./grid";
import { chooseStaff, chooseValue, hostFor, hostSpan, joinable, splitHost, valuesAt, valuesInside } from "./place";
import { quantise, type Played, type QuantiseSettings } from "./quantise";
import {
    beatLength,
    measureAt,
    readScore,
    type MeasureModel,
    type ScoreEvent,
    type ScoreModel,
    type StaffModel,
    type WrittenNote,
} from "./scoreModel";
import { spell } from "./spell";
import { buildTimeMap, localPace, msAt, onsetAt, type TimeMap } from "./timeMap";
import {
    applyEdits,
    readingsOf,
    revertTranscription,
    type Edits,
    type EventEdit,
    type NewNote,
    type OwnPlace,
    type StaffAddition,
} from "./write";

const MEI_NS = "http://www.music-encoding.org/ns/mei";

/** How a reader may ask for a divergence to be written. */
export type Notation =
    /** However the transcriber reads it: measured notes, or grace notes where it must */
    | "auto"
    /** As notes with a place in the bar and a length */
    | "measured"
    /** As grace notes before whatever they lean on */
    | "grace"
    /** As an ornament sign on the note decorated, the notes themselves left to the recording */
    | "sign"
    /** As written: the played note counts for the written one */
    | "as-written"
    /**
     * Left as the source has it. Only for a written note that was not played: a note that
     * *was* played is always in the score, as notes, as grace notes or as the sign for them.
     */
    | "none";

/**
 * What a reader has changed about one written-in note, by hand.
 *
 * Each is the thing itself and not a step from where the transcriber put it, so that it means
 * the same after the model has been improved and puts the note somewhere else of its own accord.
 */
export interface NoteEdit {
    /** Where it is written: quarter notes from the start of the piece, one of its `places` */
    onset?: number;
    /** The staff it is written on, by `@n` */
    staff?: string;
    /** How long it is written, in grid units, one of its `values` */
    units?: number;
    /**
     * The written note this played note is, by its id, where a reader said so: the two are one
     * note, whatever the aligner made of them. At the written pitch it is that note and nothing
     * differs; at another pitch it is written in that note's place.
     */
    is?: string;
}

/** One played note as it stands in the score, and what a reader may do to it. */
export interface WrittenNoteInfo {
    /** The note in the score: one written for it, or the written note it turned out to be */
    id: string;
    /** The key that was played, by {@link writtenIdOf} */
    played: string;
    /** Quarter notes from the start of the piece */
    onset: number;
    /** The bar it is in, counted from zero */
    measure: number;
    staff: string;
    /** The staves it could be on */
    staves: string[];
    grace: boolean;
    /** Every place it could be moved to, in score order */
    places: number[];
    /** Its length in grid units, where it has one of its own: a note in a chord has the chord's */
    units?: number;
    /** The lengths it could be given, longest first */
    values?: number[];
}

/** What became of one divergence. */
export interface Outcome {
    written: "measured" | "grace" | "mixed" | "sign" | "omitted" | "variant" | "as-written" | "none";
    /** A sentence for the reader saying what was written and on what grounds, or why nothing was */
    because: string;
    /** The least sure placement among its notes, in [0, 1] */
    confidence?: number;
    /** What the reader may ask for instead */
    offers: Notation[];
    /** The ids of the notes written for it */
    noteIds: string[];
    /** Those notes, each with what a reader may change about it */
    notes: WrittenNoteInfo[];
    /** The bar it is in, counted from zero, where it is in one */
    measure?: number;
    /** Which sign, where it was written as one */
    sign?: SignKind;
}

interface TranscribeInput {
    /** The score with the alignment in it: the `<recording>` `applyAlignment` wrote */
    mei: string;
    /** Which `<recording>` */
    source: string;
    divergences: readonly Divergence[];
    /** The played notes the divergences name */
    spans: readonly NoteSpan[];
    /** What the reader has asked for, by divergence id; anything absent is `auto` */
    choices?: ReadonlyMap<string, Notation>;
    /** Which sign the reader picked, for a divergence written as one; absent, it is read off the figure */
    signs?: ReadonlyMap<string, SignKind>;
    /**
     * Leave the notes that were not played standing. For drawing, not for the document: the
     * page shows them in red, which it could not if they had been taken out.
     */
    omissionsStand?: boolean;
    /** What the reader has changed about single notes, by the id the note is written under */
    edits?: ReadonlyMap<string, NoteEdit>;
    /** Who answers for the readings */
    resp?: string;
    settings?: Partial<QuantiseSettings>;
}

interface Transcribed {
    mei: string;
    outcomes: Map<string, Outcome>;
    /** The `xml:id`s of the readings written into the score, in the order they stand */
    readings: string[];
}

/**
 * The id a played note is written under: when it was struck and at what pitch.
 *
 * The same name `divergences.ts` files a reader's decisions under, and for the same reason. It
 * names the material, so it is the same string however often the document is transcribed, and
 * it is an XML name, which the id a MIDI span carries is not.
 */
export const writtenIdOf = (span: { onsetMs: number; pitch: number }): string =>
    `played-${String(Math.round(span.onsetMs))}ms-${String(span.pitch)}`;

/**
 * How far from where a written note stands a played note of its pitch may fall and still be
 * that note, in quarter notes. Wide, because the pitch already says most of it: the question is
 * only whether this C is that C, and a pianist of 1905 is a third of a beat out without trying.
 */
const SAME_NOTE_REACH = 0.35;

/** How long before a note is due the note before it may be let go and still count as held into it. */
const HELD_MS = 120;

/**
 * How long after a note is struck the key of the note before it may still be down, and the two
 * be one voice all the same: a legato. Longer than that and the first was being held while the
 * second was played, which is two voices.
 *
 * Measured by `scripts/transcription/legato.ts`. Of the notes of the corpus that another note
 * follows in their voice, half are let go before that note is struck and nine in ten within
 * this of it; of the notes another voice of their staff is struck against, half are still down
 * by then.
 */
const LEGATO_MS = 120;

/** Where the score ends, in quarter notes. */
const scoreEnd = (model: ScoreModel): number => {
    const last = model.measures[model.measures.length - 1];
    return last ? last.onset + last.duration : 0;
};

/** How many notes in a row have to go unplayed before it may be a cut rather than omissions. */
const CUT_NOTES = 6;

/** How little of its written time a passage may have been given and still count as played through. */
const CUT_SHARE = 0.35;

/**
 * Transcribe every divergence of one recording into the score.
 */
export function transcribe(input: TranscribeInput): Transcribed {
    const doc = new DOMParser().parseFromString(input.mei, "application/xml");
    revertWhens(doc, input.source);
    revertTranscription(doc);
    restoreWhens(doc, input.source);

    const model = readScore(doc);
    const recording = doc.querySelector(`recording[source="${cssEscape(input.source)}"]`);
    const outcomes = new Map<string, Outcome>();
    const choice = (id: string): Notation => input.choices?.get(id) ?? "auto";

    if (!recording) {
        return { mei: input.mei, outcomes, readings: [] };
    }

    const whens = indexWhens(recording);
    const map = buildTimeMap(
        [...whens.matched].flatMap(([id, ms]) => {
            const note = model.notes.get(id);
            return note && !note.event.grace ? [{ onset: note.event.onset, ms, pitch: note.pitch }] : [];
        }),
        // To the ends of the score, so that a note struck before the first matched moment or
        // after the last is read against something
        { from: model.measures[0]?.onset ?? 0, to: scoreEnd(model) },
    );

    const spanById = new Map(input.spans.map((span) => [span.id, span]));
    const events = new Map<ScoreEvent, EventEdit>();
    const staves = new Map<StaffModel, StaffAddition>();
    const edits: Edits = { events: [], staves: [], signs: [], unties: [], ties: [] };
    const ids = new Set<string>();

    const editOf = (event: ScoreEvent): EventEdit => {
        let edit = events.get(event);
        if (!edit) {
            edit = { event, add: [], remove: [], replace: new Map(), graces: [], inside: [] };
            events.set(event, edit);
            edits.events.push(edit);
        }
        return edit;
    };

    const newNote = (span: NoteSpan, group: string, cause: string, confidence: number, staff: StaffModel, onset: number): NewNote => {
        // Two keys of one pitch cannot go down in the same millisecond, so this is one note
        const id = writtenIdOf(span);
        ids.add(id);
        return {
            id,
            pitch: span.pitch,
            spelling: spell(span.pitch, { key: staff.key, around: around(model, staff.measure, onset) }),
            group,
            cause,
            confidence,
        };
    };

    const firstMs = map.anchors[0]?.ms ?? 0;
    const lastMs = map.anchors[map.anchors.length - 1]?.ms ?? 0;

    // Every tie, by the note it runs into
    const tieInto = new Map<string, Element>();
    const tiedOn = new Map<string, string>();
    for (const tie of doc.querySelectorAll("tie")) {
        const from = tie.getAttribute("startid")?.replace(/^#/, "");
        const to = tie.getAttribute("endid")?.replace(/^#/, "");
        if (from && to) {
            tieInto.set(to, tie);
            tiedOn.set(from, to);
        }
    }

    // The written notes nothing was played for, which a played note may yet turn out to be
    const unplayed = new Map<string, WrittenNote>();
    for (const divergence of input.divergences) {
        if (divergence.kind !== "missing" || divergence.reading === "outside") continue;
        for (const id of divergence.scoreIds) {
            const note = model.notes.get(id);
            if (note) unplayed.set(id, note);
        }
    }

    /** Played notes that are a note the score already has, and which. */
    const found: {
        span: NoteSpan;
        divergence: Extract<Divergence, { kind: "added" }>;
        note: WrittenNote;
        tie?: Element;
    }[] = [];
    const taken = new Set<string>();
    /** Played notes a reader said are a written note, played at another pitch. */
    const stoodIn: { span: NoteSpan; divergence: Extract<Divergence, { kind: "added" }>; note: WrittenNote }[] = [];
    const standIns: { span: NoteSpan; id: string }[] = [];

    /**
     * The written note a played note is, where it is one.
     *
     * Two cases, and in both the score needs no new note. A written note of that pitch went
     * unplayed at that very place: the two are one note the aligner did not pair. Or the score
     * ties a note of that pitch over that place: the performer did not hold it but struck it
     * again, and what changes in the score is the tie.
     */
    const writtenFor = (span: NoteSpan): { note: WrittenNote; tie?: Element } | undefined => {
        const at = onsetAt(map, Math.min(Math.max(span.onsetMs, firstMs), lastMs));
        if (at === undefined) return undefined;

        let best: { note: WrittenNote; tie?: Element; away: number } | undefined;
        const consider = (note: WrittenNote, tie: Element | undefined, reach: number) => {
            if (note.pitch !== span.pitch || note.event.grace || taken.has(note.id)) return;
            const away = at - note.event.onset;
            // A little before it is due, or any time while it would still have been sounding
            if (away < -SAME_NOTE_REACH || away > reach) return;
            if (!best || Math.abs(away) < Math.abs(best.away)) best = { note, tie, away };
        };

        for (const note of unplayed.values()) consider(note, undefined, SAME_NOTE_REACH);
        for (const [id, tie] of tieInto) {
            const note = model.notes.get(id);
            if (note) consider(note, tie, Math.max(SAME_NOTE_REACH, Math.min(note.event.duration * 0.75, 1)));
        }
        if (!best) return undefined;
        taken.add(best.note.id);
        return { note: best.note, tie: best.tie };
    };

    // ---- What was played and is not written ----

    const played: Played[] = [];
    const groupOf = new Map<string, Extract<Divergence, { kind: "added" }>>();
    const forced = new Map<string, "measured" | "grace">();

    for (const divergence of input.divergences) {
        if (divergence.kind !== "added") continue;
        // What was played is in the score, one way or another: leaving it out is not a way
        const asked = choice(divergence.id) === "none" ? "auto" : choice(divergence.id);
        const offers = offersFor(divergence);

        // A figure that stays out of the score still has a bar: the one its note is in
        const bar = divergence.anchorId
            ? model.notes.get(divergence.anchorId)?.event.layer.staff.measure.index
            : undefined;
        if (asked === "auto" && NOT_THE_TEXT.has(divergence.reading)) {
            outcomes.set(divergence.id, {
                ...none(WHY_NOT[divergence.reading] ?? "Not part of the text.", offers),
                measure: bar,
            });
            continue;
        }
        if (asked === "sign") {
            const anchor = divergence.anchorId ? model.notes.get(divergence.anchorId) : undefined;
            if (anchor) {
                const picked = input.signs?.get(divergence.id);
                const sign = picked ? signOf(picked) : signFor(divergence.pitches, anchor.pitch);
                edits.signs.push({ anchor, sign, group: divergence.id, confidence: 1 });
                outcomes.set(divergence.id, {
                    written: "sign",
                    sign: kindOf(sign),
                    because: `Written as a ${sign.name} on the note it decorates. The ${String(divergence.perfIds.length)} notes played stay in the recording as how it was played.`,
                    offers,
                    noteIds: [],
                    notes: [],
                    measure: anchor.event.layer.staff.measure.index,
                });
                continue;
            }
        }

        for (const id of divergence.perfIds) {
            const span = spanById.get(id);
            if (!span) continue;

            // A reader may have said which written note this is. Then it is that note
            const said = input.edits?.get(writtenIdOf(span))?.is;
            const named = said ? model.notes.get(said) : undefined;
            if (named && !named.event.grace && !taken.has(named.id)) {
                taken.add(named.id);
                if (named.pitch === span.pitch) found.push({ span, divergence, note: named });
                else stoodIn.push({ span, divergence, note: named });
                continue;
            }

            // Before it is treated as a new note: it may be a note the score has. The written
            // note itself, which the aligner did not pair; or the second note of a tie, which
            // the score holds and the performer struck.
            const written = asked === "auto" ? writtenFor(span) : undefined;
            if (written) {
                found.push({ span, divergence, ...written });
                continue;
            }

            // Struck outside everything the score has time for: read at its nearest end
            const onsetMs = Math.min(Math.max(span.onsetMs, firstMs + 1), lastMs - 1);
            played.push({ id: span.id, onsetMs, offsetMs: span.offsetMs, pitch: span.pitch, velocity: span.velocity });
            groupOf.set(span.id, divergence);
            if (asked === "measured" || asked === "grace") forced.set(span.id, asked);
        }
    }

    const editOfSpan = (span: { onsetMs: number; pitch: number }) => input.edits?.get(writtenIdOf(span));
    const quantised = quantise(model, map, played, {
        settings: input.settings,
        force: (cluster) => {
            const kind = forced.get(cluster.notes[0].id);
            // Notes struck together are one moment, so moving one of them moves the moment
            const onset = cluster.notes.map((note) => editOfSpan(note)?.onset).find((at) => at !== undefined);
            return kind || onset !== undefined ? { kind, onset } : undefined;
        },
    });

    /** What each divergence's notes are in the score, for a reader to act on. */
    const infos = new Map<string, WrittenNoteInfo[]>();
    const places = new Map<WrittenNoteInfo, OwnPlace>();
    const inform = (group: string, info: WrittenNoteInfo): WrittenNoteInfo => {
        const list = infos.get(group);
        if (list) list.push(info);
        else infos.set(group, [info]);
        return info;
    };

    // Per divergence, what each of its notes came to
    const fates = new Map<string, Fate[]>();
    const fate = (group: string, entry: Fate) => {
        const list = fates.get(group);
        if (list) list.push(entry);
        else fates.set(group, [entry]);
    };

    /** Notes at a place of their own, waiting to be told which voice they are written in. */
    const pending: {
        staff: StaffModel;
        onset: number;
        /** When it was struck */
        ms: number;
        pitch: number;
        place: OwnPlace;
        info: WrittenNoteInfo;
        entry: Fate;
        where: string;
    }[] = [];

    /** Grace moments waiting for the thing they lean on, with the written moment that would end the wait. */
    let waiting: { moment: { span: NoteSpan; divergence: Extract<Divergence, { kind: "added" }>; confidence: number }[]; before: number }[] = [];

    /** Hand waiting grace notes to a written event. */
    const leanOnWritten = (grace: (typeof waiting)[number]) => {
        const anchor = map.anchors.find((candidate) => candidate.first >= grace.before - 1e-6);
        const measure = anchor ? measureAt(model, anchor.onset) : undefined;
        const pitch = grace.moment[0].span.pitch;
        const staff = anchor && measure ? chooseStaff(measure, anchor.onset, pitch) : undefined;
        const event =
            anchor && measure && staff
                ? joinable(staff, anchor.onset, pitch) ??
                  measure.staves.map((other) => joinable(other, anchor.onset, pitch)).find((found) => found !== undefined)
                : undefined;

        if (!anchor || !event) {
            for (const { divergence, confidence } of grace.moment) {
                fate(divergence.id, { kind: "unplaced", confidence, because: "Nothing written follows for it to lean on." });
            }
            return;
        }
        editOf(event).graces.push(
            grace.moment.map(({ span, divergence, confidence }) => {
                fate(divergence.id, { kind: "grace", confidence, where: describe(model, anchor.onset) });
                const note = newNote(span, divergence.id, divergence.reading, confidence, event.layer.staff, anchor.onset);
                inform(divergence.id, {
                    id: note.id,
                    played: note.id,
                    onset: anchor.onset,
                    measure: event.layer.staff.measure.index,
                    staff: event.layer.staff.n,
                    staves: [event.layer.staff.n],
                    grace: true,
                    places: [],
                });
                return note;
            }),
        );
    };

    for (const entry of quantised) {
        const members = entry.cluster.notes.flatMap((note) => {
            const span = spanById.get(note.id);
            const divergence = groupOf.get(note.id);
            return span && divergence ? [{ span, divergence, confidence: entry.confidence }] : [];
        });
        if (members.length === 0) continue;

        if (entry.placement.kind === "unplaced") {
            for (const { divergence } of members) {
                fate(divergence.id, { kind: "unplaced", confidence: 1, because: entry.placement.because });
            }
            continue;
        }

        if (entry.placement.kind === "grace") {
            const next = map.anchors.find((anchor) => anchor.first > entry.cluster.ms + 1e-6);
            waiting.push({ moment: members, before: next ? next.first : Infinity });
            continue;
        }

        // Measured. Anything waiting that a written moment came between leans on that instead
        const onset = entry.placement.onset;
        const leaning = waiting.filter((grace) => grace.before > entry.cluster.ms);
        waiting.filter((grace) => grace.before <= entry.cluster.ms).forEach(leanOnWritten);
        waiting = [];

        const measure = measureAt(model, onset);
        if (!measure) {
            for (const { divergence } of members) fate(divergence.id, { kind: "unplaced", confidence: 1, because: "No bar at that place." });
            leaning.forEach(leanOnWritten);
            continue;
        }

        let leaned = false;
        for (const member of members) {
            const { span, divergence, confidence } = member;
            const asked = editOfSpan(span);
            const staff =
                measure.staves.find((candidate) => candidate.n === asked?.staff) ??
                chooseStaff(measure, onset, span.pitch) ??
                measure.staves[0];
            if (!staff) continue;
            const where = describe(model, onset);
            const about = (note: NewNote, on: StaffModel): WrittenNoteInfo =>
                inform(divergence.id, {
                    id: note.id,
                    played: note.id,
                    onset,
                    measure: measure.index,
                    staff: on.n,
                    staves: measure.staves.map((candidate) => candidate.n),
                    grace: false,
                    places: entry.places,
                });

            const event =
                joinable(staff, onset, span.pitch) ??
                // A place no grid has, a quintuplet's third note, can only be written with the
                // note that is already there, on whichever staff has it
                (isOnGrid(onset, measure) ? undefined : measure.staves.map((other) => joinable(other, onset, span.pitch)).find((found) => found !== undefined));

            if (event) {
                const edit = editOf(event);
                const joined = newNote(span, divergence.id, divergence.reading, confidence, event.layer.staff, onset);
                edit.add.push(joined);
                about(joined, event.layer.staff);
                if (!leaned) {
                    edit.graces.push(...graceNotes(leaning, event.layer.staff, onset));
                    leaned = true;
                }
                fate(divergence.id, { kind: "measured", confidence, where: `${where}, with what is written there` });
                continue;
            }

            if (!isOnGrid(onset, measure)) {
                fate(divergence.id, { kind: "unplaced", confidence, because: "It falls where this bar has no place for a new note." });
                continue;
            }

            const start = Math.round((onset - measure.onset) * UNITS);
            const own = newNote(span, divergence.id, divergence.reading, confidence, staff, onset);
            const place: OwnPlace = {
                start,
                // Settled below, once every note of the bar has its place
                value: chooseValue(start, Infinity, measure),
                notes: [own],
                graces: leaned ? [] : graceNotes(leaning, staff, onset),
            };
            leaned = true;
            // Which voice, and so how it is said, is settled with the length
            const said: Fate = { kind: "measured", confidence, where };
            fate(divergence.id, said);
            pending.push({ staff, onset, ms: span.onsetMs, pitch: span.pitch, place, info: about(own, staff), entry: said, where });
        }

        function graceNotes(graces: typeof waiting, staff: StaffModel, at: number): NewNote[][] {
            return graces.map((grace) =>
                grace.moment.map(({ span, divergence, confidence }) => {
                    fate(divergence.id, { kind: "grace", confidence, where: describe(model, at) });
                    const note = newNote(span, divergence.id, divergence.reading, confidence, staff, at);
                    inform(divergence.id, {
                        id: note.id,
                        played: note.id,
                        onset: at,
                        measure: staff.measure.index,
                        staff: staff.n,
                        staves: [staff.n],
                        grace: true,
                        places: [],
                    });
                    return note;
                }),
            );
        }
    }
    waiting.forEach(leanOnWritten);

    // ---- Which voice a note of its own is written in ----

    // A note of its own was struck while its staff was in the middle of something, and is
    // written into that: the voice that was silent there, or the note that was sounding, which
    // then ends where the new one begins. One voice plays one thing after another, and a second
    // voice for every added note would say the performer had played in two. Where they did,
    // the first note still held down under the second, a second voice is what it gets.
    const hosted = new Map<ScoreEvent, typeof pending>();
    const voiceless: typeof pending = [];
    for (const entry of pending) {
        const host = hostFor(entry.staff, entry.onset, entry.pitch, (event) =>
            event.notes.every((note) => {
                const released = whens.released.get(note.id);
                return released === undefined || released <= entry.ms + LEGATO_MS;
            }),
        );
        if (!host) {
            voiceless.push(entry);
            continue;
        }
        const group = hosted.get(host);
        if (group) group.push(entry);
        else hosted.set(host, [entry]);
    }

    /** Everything struck on a staff, written or just placed, in grid units from the barline. */
    const struckOn = (staff: StaffModel): number[] => {
        const measure = staff.measure;
        const onsets = new Set<number>();
        for (const entry of pending) if (entry.staff === staff) onsets.add(entry.place.start);
        for (const layer of staff.layers) {
            for (const event of layer.events) {
                if (!event.grace && event.notes.length > 0) {
                    onsets.add(Math.round((event.onset - measure.onset) * UNITS * 1e6) / 1e6);
                }
            }
        }
        return [...onsets].sort((a, b) => a - b);
    };

    for (const [host, group] of hosted) {
        const span = hostSpan(host);
        const measure = host.layer.staff.measure;
        const silent = host.notes.length === 0;
        if (!span) {
            voiceless.push(...group);
            continue;
        }

        // Moments struck together are one chord of one length
        interface Moment { place: OwnPlace; members: typeof pending; values: number[] }
        const moments: Moment[] = [];
        for (const entry of [...group].sort((a, b) => a.place.start - b.place.start)) {
            const last = moments[moments.length - 1];
            if (last && last.place.start === entry.place.start) {
                last.place.notes.push(...entry.place.notes);
                last.place.graces.push(...entry.place.graces);
                last.members.push(entry);
            } else {
                moments.push({
                    place: { ...entry.place, notes: [...entry.place.notes], graces: [...entry.place.graces] },
                    members: [entry],
                    values: [],
                });
            }
        }

        // How long each is written: to the next note of its voice, which in a voice that was
        // sounding is where that voice goes on. A voice that was silent goes on being silent,
        // and there the note is as long as it is to the next thing in its hand
        const struck = silent ? struckOn(host.layer.staff) : [];
        const settle = (list: Moment[]): boolean => {
            const starts = list.map((moment) => moment.place.start);
            for (const [index, moment] of list.entries()) {
                const until = struck.find((onset) => onset > moment.place.start + 1e-6);
                const values = valuesInside(span, starts, index, measure, until);
                if (values.length === 0) return false;
                // And as long as a reader has said, where they have
                const asked = moment.members
                    .map((member) => input.edits?.get(member.info.id)?.units)
                    .find((units) => units !== undefined);
                moment.place.value = values.find((value) => value.units === asked) ?? values[0];
                moment.values = values.map((value) => value.units);
            }
            const items = list.map(({ place }) => ({ start: place.start, value: place.value, payload: place }));
            return splitHost(span, items, measure) !== undefined;
        };

        // One at a time, so that a moment the event has no place for, a triplet that would not
        // close inside it, takes none of the others with it into a voice of its own
        const taken: Moment[] = [];
        for (const moment of moments) {
            if (settle([...taken, moment])) taken.push(moment);
            else voiceless.push(...moment.members);
        }
        // Once more for the ones that stay, whose lengths the last one tried may have changed
        if (taken.length === 0) continue;
        if (!settle(taken)) {
            voiceless.push(...taken.flatMap((moment) => moment.members));
            continue;
        }

        editOf(host).inside.push(...taken.map((moment) => moment.place));
        for (const moment of taken) {
            for (const member of moment.members) {
                member.info.units = moment.place.value.units;
                member.info.values = moment.values;
                member.entry.where = silent
                    ? `${member.where}, in a voice that was silent there`
                    : `${member.where}, after the note it was played during, which ends there`;
            }
        }
    }

    for (const entry of voiceless) {
        let addition = staves.get(entry.staff);
        if (!addition) {
            addition = { staff: entry.staff, places: [] };
            staves.set(entry.staff, addition);
            edits.staves.push(addition);
        }
        addition.places.push(entry.place);
        places.set(entry.info, entry.place);
        entry.entry.where = `${entry.where}, in a voice of its own`;
    }

    // How long each note in a voice of its own is written: up to the next thing in its hand,
    // which may be a written note or another one just placed
    for (const addition of edits.staves) {
        const measure = addition.staff.measure;
        const onsets = new Set<number>(addition.places.map((place) => place.start));
        for (const layer of addition.staff.layers) {
            for (const event of layer.events) {
                if (!event.grace && event.notes.length > 0) {
                    onsets.add(Math.round((event.onset - measure.onset) * UNITS * 1e6) / 1e6);
                }
            }
        }
        const sorted = [...onsets].sort((a, b) => a - b);
        for (const place of addition.places) {
            const next = sorted.find((onset) => onset > place.start + 1e-6);
            place.value = chooseValue(place.start, next === undefined ? Infinity : next - place.start, measure);
        }
    }

    // And as long as a reader has said, where they have
    for (const [info, place] of places) {
        const measure = model.measures[info.measure];
        const values = valuesAt(place.start, measure);
        const asked = values.find((value) => value.units === input.edits?.get(info.id)?.units);
        if (asked) place.value = asked;
        info.units = place.value.units;
        info.values = values.map((value) => value.units);
    }

    // The played notes that are notes of the score: nothing new is written for them
    for (const { span, divergence, note, tie } of found) {
        const where = describe(model, note.event.onset);
        if (tie) edits.unties.push({ tie, group: divergence.id, confidence: 1 });
        fate(
            divergence.id,
            tie
                ? { kind: "measured", confidence: 1, where: `${where}, where the score ties it: struck again` }
                : { kind: "written", confidence: 1 },
        );
        inform(divergence.id, {
            id: note.id,
            played: writtenIdOf(span),
            onset: note.event.onset,
            measure: note.event.layer.staff.measure.index,
            staff: note.event.layer.staff.n,
            staves: [note.event.layer.staff.n],
            grace: false,
            places: [],
        });
    }

    // And the ones a reader said are a written note at another pitch: the played note is
    // written in that note's place, as a note played otherwise is
    for (const { span, divergence, note } of stoodIn) {
        const staff = note.event.layer.staff;
        const played = newNote(span, divergence.id, "substitution", 1, staff, note.event.onset);
        editOf(note.event).replace.set(note, played);
        standIns.push({ span, id: played.id });
        fate(divergence.id, {
            kind: "variant",
            confidence: 1,
            where: `${nameOf(played)} written in place of the ${note.pname.toUpperCase()}${String(note.oct)} of the source`,
        });
        inform(divergence.id, {
            id: played.id,
            played: played.id,
            onset: note.event.onset,
            measure: staff.measure.index,
            staff: staff.n,
            staves: [staff.n],
            grace: false,
            places: [],
        });
    }

    for (const [group, list] of fates) {
        const divergence = input.divergences.find((candidate) => candidate.id === group);
        if (!divergence || divergence.kind !== "added") continue;
        const outcome = summarise(list, offersFor(divergence));
        outcome.notes = infos.get(group) ?? [];
        outcome.measure = outcome.notes[0]?.measure;
        outcomes.set(group, outcome);
    }

    // ---- What is written and was not played ----

    /**
     * The note a written note was held on from, where it was: the one of its pitch on its
     * staff that is written right up to it, was played, and was still down when this was due.
     */
    const heldInto = (note: WrittenNote): WrittenNote | undefined => {
        if (note.event.grace) return undefined;
        const due = msAt(map, note.event.onset);
        if (due === undefined) return undefined;

        for (const staff of note.event.layer.staff.measure.staves.concat(
            model.measures[note.event.layer.staff.measure.index - 1]?.staves ?? [],
        )) {
            if (staff.n !== note.event.layer.staff.n) continue;
            for (const layer of staff.layers) {
                for (const event of layer.events) {
                    if (event.grace || Math.abs(event.onset + event.duration - note.event.onset) > 1e-6) continue;
                    const before = event.notes.find((other) => other.pitch === note.pitch);
                    if (!before || tiedOn.has(before.id)) continue;
                    const released = whens.released.get(before.id);
                    if (released !== undefined && released >= due - HELD_MS) return before;
                }
            }
        }
        return undefined;
    };

    for (const divergence of input.divergences) {
        if (divergence.kind !== "missing") continue;
        // What was not played is not in the score as it was played, as what was played is in
        // it: an omission cannot be asked to stay, and a choice of that in an older work file
        // reads as no choice
        const offers: Notation[] = ["auto"];

        const notes = divergence.scoreIds.flatMap((id) => {
            const note = model.notes.get(id);
            return note ? [note] : [];
        });
        const bar = notes[0]?.event.layer.staff.measure.index;

        // For the page and not for the document: a note that has been taken out cannot be
        // seen to have been taken out, so the page is drawn with these still standing
        if (input.omissionsStand) {
            outcomes.set(divergence.id, { ...none("Left standing, to be seen.", offers), measure: bar });
            continue;
        }
        if (divergence.reading === "outside") {
            outcomes.set(divergence.id, none("Beyond where the recording reaches, so not something the performer left out.", offers));
            continue;
        }

        if (notes.length === 0) {
            outcomes.set(divergence.id, none("The notes are not in this reading of the score.", offers));
            continue;
        }

        if (isCut(notes, map)) {
            outcomes.set(
                divergence.id,
                none(
                    `${String(notes.length)} notes the recording passes over without taking their time: a cut, ` +
                        `which is a statement about the bars and not about each note in them. Left as written.`,
                    offers,
                ),
            );
            continue;
        }

        let omitted = 0;
        let doubled = 0;
        let held = 0;
        let played = 0;
        for (const note of notes) {
            // A played note turned out to be this one
            if (taken.has(note.id)) {
                played++;
                continue;
            }

            // A unison written in two voices is one key. The voice that got the match played
            // it for both, and nothing was left out
            const twin = note.event.grace
                ? undefined
                : [...model.notes.values()].find(
                      (other) =>
                          other !== note &&
                          other.pitch === note.pitch &&
                          Math.abs(other.event.onset - note.event.onset) < 1e-6 &&
                          whens.matched.has(other.id),
                  );
            if (twin) {
                doubled++;
                continue;
            }

            // Not struck because the note before it was never let go: the same pitch, written
            // up to this note, and still held when this one was due. That is a tie.
            const before = heldInto(note);
            if (before) {
                held++;
                edits.ties.push({ from: before, to: note, group: divergence.id });
                continue;
            }

            omitted++;
            editOf(note.event).remove.push(note);
            // What it is tied into goes with it: a tie has nothing to hold
            const seen = new Set([note.id]);
            for (let next = tiedOn.get(note.id); next && !seen.has(next); next = tiedOn.get(next)) {
                seen.add(next);
                const tied = model.notes.get(next);
                if (tied) editOf(tied.event).remove.push(tied);
            }
        }

        outcomes.set(
            divergence.id,
            omitted + held === 0
                ? none(
                      played > 0
                          ? "The written note was played: the aligner had not paired the two."
                          : "A unison written in two voices and played as the one key it is. Nothing was left out.",
                      offers,
                  )
                : {
                      written: "omitted",
                      because:
                          [
                              omitted > 0
                                  ? `${omitted === 1 ? "The note is" : `${String(omitted)} notes are`} taken out of the performance reading`
                                  : "",
                              held > 0
                                  ? `${held === 1 ? "The note is" : `${String(held)} notes are`} tied to the one before: held, not struck again`
                                  : "",
                              doubled > 0 ? `${String(doubled)} more are unisons the other voice played` : "",
                          ]
                              .filter((part) => part)
                              .join("; ") + ".",
                      offers,
                      noteIds: [],
                      notes: [],
                  },
        );
        const kept = outcomes.get(divergence.id);
        if (kept) kept.measure = notes[0].event.layer.staff.measure.index;
    }

    // ---- What was played at another pitch ----

    const mended: { scoreId: string; newId?: string; span: NoteSpan }[] = [];
    for (const divergence of input.divergences) {
        if (divergence.kind !== "replaced") continue;
        const offers: Notation[] = ["auto", "as-written"];
        const asked = choice(divergence.id) === "none" ? "auto" : choice(divergence.id);

        const note = model.notes.get(divergence.scoreId);
        const span = spanById.get(divergence.perfId);
        if (!note || !span) {
            outcomes.set(divergence.id, none("The note is not in this reading of the score.", offers));
            continue;
        }

        if (asked === "as-written" || divergence.reading === "unmatched-pair") {
            mended.push({ scoreId: note.id, span });
            outcomes.set(divergence.id, {
                written: "as-written",
                because:
                    divergence.reading === "unmatched-pair"
                        ? "The written note itself, which the aligner had not paired. Counted as played."
                        : "Counted as the written note, as asked.",
                offers,
                noteIds: [],
                notes: [],
                measure: note.event.layer.staff.measure.index,
            });
            continue;
        }

        const played = newNote(span, divergence.id, "substitution", 1, note.event.layer.staff, note.event.onset);
        editOf(note.event).replace.set(note, played);
        mended.push({ scoreId: note.id, newId: played.id, span });
        outcomes.set(divergence.id, {
            written: "variant",
            because: `The played ${nameOf(played)} written in place of the ${note.pname.toUpperCase()}${String(note.oct)} of the source.`,
            offers,
            noteIds: [played.id],
            notes: [],
            measure: note.event.layer.staff.measure.index,
        });
    }

    // A note cannot both be played at another pitch and not be played
    for (const edit of edits.events) {
        edit.remove = edit.remove.filter((note) => !edit.replace.has(note));
    }

    const written = applyEdits(model, edits, { resp: input.resp });

    // The recording now points at the notes that were written for it
    for (const [group, noteIds] of written) {
        const outcome = outcomes.get(group);
        if (outcome) outcome.noteIds = noteIds;
    }
    // And at the notes that were tied and are now struck. A written note the aligner had merely
    // not paired is no difference, and is not counted as one
    for (const { divergence, note, tie } of found) {
        if (tie) outcomes.get(divergence.id)?.noteIds.push(note.id);
    }
    const placed = (place: OwnPlace): NewNote[] => [...place.notes, ...place.graces.flat()];
    for (const note of edits.events
        .flatMap((edit) => [...edit.add, ...edit.graces.flat(), ...edit.inside.flatMap(placed)])
        .concat(edits.staves.flatMap((addition) => addition.places.flatMap(placed)))) {
        const when = whens.insertions.get(whenKey(Number(/^played-(\d+)ms/.exec(note.id)?.[1] ?? NaN), note.pitch));
        if (!when) continue;
        when.setAttribute("data", `#${note.id}`);
        when.removeAttribute("type");
        mark(doc, when, "insertion");
    }
    for (const { span, id } of [...found.map(({ span, note }) => ({ span, id: note.id })), ...standIns]) {
        const when = whens.insertions.get(whenKey(span.onsetMs, span.pitch));
        if (!when) continue;
        when.setAttribute("data", `#${id}`);
        when.removeAttribute("type");
        mark(doc, when, "insertion");
    }
    for (const { scoreId, newId, span } of mended) {
        const when = whens.substitutions.get(scoreId);
        if (when) {
            when.removeAttribute("type");
            mark(doc, when, "substitution", scoreId);
            if (newId) when.setAttribute("data", `#${newId}`);
            continue;
        }
        // A saved recording has the two halves apart, a played note with no written one and a
        // written note nothing was played for. The played half is the one to point somewhere
        const loose = whens.insertions.get(whenKey(span.onsetMs, span.pitch));
        if (!loose) continue;
        loose.setAttribute("data", `#${newId ?? scoreId}`);
        loose.removeAttribute("type");
        mark(doc, loose, "insertion");
    }

    return { mei: new XMLSerializer().serializeToString(doc), outcomes, readings: readingsOf(doc) };
}

/**
 * The score with every transcribed reading taken out again and the recording as the aligner left it.
 *
 * It reads a document in either of two states. One still in work carries a mark on every record
 * the transcriber repointed, and those are put back by the mark. One that was saved carries none:
 * `./strictRecordings` wrote its recordings as the as-played-by format has them, and what
 * the aligner had found is read back off the score instead ({@link restoreWhens}).
 */
export function untranscribed(mei: string, source?: string): string {
    if (
        !mei.includes(`type="transcription"`) &&
        !mei.includes(`type="transcribed"`) &&
        !SAVED.test(mei)
    ) {
        return mei;
    }
    const doc = new DOMParser().parseFromString(mei, "application/xml");
    revertWhens(doc, source);
    revertTranscription(doc);
    restoreWhens(doc, source);
    return new XMLSerializer().serializeToString(doc);
}

/** What only a saved recording has: a sounded note typed as the match it is. */
const SAVED = /type=["']match["']/;

// ---------------------------------------------------------------------------------------------

/** Readings that are not the performer changing the text, and so are not written unasked. */
const NOT_THE_TEXT = new Set(["written-ornament", "repeat-pass"]);

const WHY_NOT: Record<string, string> = {
    "written-ornament":
        "The score writes an ornament sign on this note, and these are that ornament being played. " +
        "The text already has it.",
    "repeat-pass":
        "Played on a repeat the engraving shows once, so there is no bar in this score to write it into.",
};

/**
 * What an added figure may be written as.
 *
 * A sign only for a figure: something the model read as ornamenting a note, or several notes
 * around one. An octave struck with the bass decorates nothing, and offering to write it as a
 * trill would be offering nonsense with a button on it.
 */
const offersFor = (divergence: Extract<Divergence, { kind: "added" }>): Notation[] => {
    if (divergence.reading === "written-ornament") return ["auto"];
    const figure =
        divergence.anchorId !== null &&
        (divergence.reading === "ornamentation" || divergence.perfIds.length > 1);
    return ["auto", "measured", "grace", ...(figure ? (["sign"] as Notation[]) : [])];
};

const none = (because: string, offers: Notation[]): Outcome => ({
    written: "none",
    because,
    offers,
    noteIds: [],
    notes: [],
});

/**
 * What became of one played note: written as a note or a grace note, not placed, or found to be
 * a note the score already writes.
 */
interface Fate {
    kind: "measured" | "grace" | "unplaced" | "written" | "variant";
    confidence: number;
    where?: string;
    because?: string;
}

function summarise(all: Fate[], offers: Notation[]): Outcome {
    // The written notes among them: played as written, and so no difference at all
    const same = all.length - all.filter((entry) => entry.kind !== "written").length;
    // And the ones that are a written note at another pitch, on a reader's word
    const others = all.filter((entry) => entry.kind === "variant");
    const list = all.filter((entry) => entry.kind !== "written" && entry.kind !== "variant");
    if (list.length === 0 && others.length > 0) {
        return {
            written: "variant",
            because: `The played ${others.map((entry) => entry.where ?? "").join("; ")}: one note, the reader says, played otherwise.`,
            offers: ["auto"],
            noteIds: [],
            notes: [],
        };
    }
    if (list.length === 0) {
        return {
            written: "as-written",
            because: `The written ${same === 1 ? "note" : "notes"} itself, which the aligner had not paired. Counted as played.`,
            offers: ["auto"],
            noteIds: [],
            notes: [],
        };
    }

    const placed = list.filter((entry) => entry.kind !== "unplaced");
    if (placed.length === 0) return none(list[0]?.because ?? "Not placed.", offers);

    const measured = placed.filter((entry) => entry.kind === "measured").length;
    const graces = placed.length - measured;
    const confidence = Math.min(...placed.map((entry) => entry.confidence));
    const first = placed[0].where ?? "";
    const left = list.length - placed.length;

    const what =
        graces === 0
            ? `${placed.length === 1 ? "Written" : `${String(placed.length)} notes written`} ${first}`
            : measured === 0
              ? `${placed.length === 1 ? "Written as a grace note" : `${String(placed.length)} grace notes`} before ${first}`
              : `${String(measured)} measured and ${String(graces)} as grace notes, from ${first}`;

    // How sure, said only where it is worth a second look: most notes are where they
    // obviously belong, and a percentage on every one of them would be noise
    const doubt =
        confidence >= 0.8
            ? ""
            : confidence >= 0.5
              ? ` The timing would also allow another place (${String(Math.round(confidence * 100))}% sure).`
              : ` The timing fits other places nearly as well (${String(Math.round(confidence * 100))}% sure): worth a look.`;

    return {
        written: graces === 0 ? "measured" : measured === 0 ? "grace" : "mixed",
        because:
            `${what}.${doubt}` +
            (left > 0 ? ` ${String(left)} more could not be placed.` : "") +
            (same > 0 ? ` ${String(same)} more ${same === 1 ? "is a written note" : "are written notes"} the aligner had not paired.` : ""),
        confidence,
        offers,
        noteIds: [],
        notes: [],
    };
}

/** Where a moment is, in words: the bar and the beat. */
function describe(model: ScoreModel, onset: number): string {
    const measure = measureAt(model, onset);
    if (!measure) return "";
    const beat = beatLength(measure.meter);
    const within = (onset - measure.onset) / beat;
    const whole = Math.floor(within + 1e-9);
    const part = within - whole;
    const bar = measure.element.getAttribute("n") ?? String(measure.index + 1);

    let fraction = "";
    if (part > 1e-6) {
        for (const parts of [2, 3, 4, 6, 8, 12, 16]) {
            const count = part * parts;
            if (Math.abs(count - Math.round(count)) < 1e-6) {
                fraction = ` and ${String(Math.round(count))}/${String(parts)}`;
                break;
            }
        }
        if (!fraction) fraction = ` and ${part.toFixed(2)}`;
    }
    return `in bar ${bar} on beat ${String(whole + 1)}${fraction}`;
}

const nameOf = (note: NewNote): string =>
    `${note.spelling.pname.toUpperCase()}${note.spelling.alter === 1 ? "♯" : note.spelling.alter === -1 ? "♭" : ""}${String(note.spelling.oct)}`;

const isOnGrid = (onset: number, measure: MeasureModel): boolean => {
    const units = (onset - measure.onset) * UNITS;
    return Math.abs(units - Math.round(units)) < 1e-6 && levelOf(onset - measure.onset, measure.meter) !== 0;
};

/** The written notes near a moment, nearest first: what a new note is spelled against. */
function around(model: ScoreModel, measure: MeasureModel, onset: number): WrittenNote[] {
    const found: { note: WrittenNote; away: number }[] = [];
    for (const index of [measure.index - 1, measure.index, measure.index + 1]) {
        const neighbour = model.measures[index];
        if (!neighbour) continue;
        for (const staff of neighbour.staves) {
            for (const layer of staff.layers) {
                for (const event of layer.events) {
                    for (const note of event.notes) found.push({ note, away: Math.abs(event.onset - onset) });
                }
            }
        }
    }
    return found.sort((a, b) => a.away - b.away).map((entry) => entry.note);
}

/**
 * Whether a run of unplayed notes is a cut: bars the recording does not spend the time of.
 *
 * A performer who leaves a chord thin still plays through the bar, and the notes around it are
 * as far apart as ever. One who cuts sixteen bars arrives at the seventeenth at once.
 */
function isCut(notes: WrittenNote[], map: TimeMap): boolean {
    if (notes.length < CUT_NOTES) return false;
    const from = Math.min(...notes.map((note) => note.event.onset));
    const to = Math.max(...notes.map((note) => note.event.onset));
    if (to - from < 1) return false;

    const { anchors } = map;
    let before = -1;
    let after = -1;
    anchors.forEach((anchor, index) => {
        if (anchor.onset < from - 1e-6) before = index;
        if (after < 0 && anchor.onset > to + 1e-6) after = index;
    });
    if (before < 0 || after < 0) return true;

    // Any anchor inside means the passage was played through, with these notes missing from it
    if (after - before > 1) return false;

    const pace = localPace(map, Math.max(0, before - 3));
    const written = (anchors[after].onset - anchors[before].onset) * pace;
    return anchors[after].ms - anchors[before].ms < CUT_SHARE * written;
}

// ---- The recording ---------------------------------------------------------------------------

const whenKey = (ms: number, pitch: number): string => `${String(Math.round(ms))}|${String(pitch)}`;

const extOf = (when: Element, type: string): string | undefined => {
    for (const child of when.children) {
        if (child.localName === "extData" && child.getAttribute("type") === type) return child.textContent ?? "";
    }
    return undefined;
};

function indexWhens(recording: Element) {
    const matched = new Map<string, number>();
    /** When each matched note was let go */
    const released = new Map<string, number>();
    const insertions = new Map<string, Element>();
    const substitutions = new Map<string, Element>();

    for (const when of recording.children) {
        if (when.localName !== "when") continue;
        const type = when.getAttribute("type");
        const data = when.getAttribute("data")?.replace(/^#/, "");
        const absolute = when.getAttribute("absolute");
        const ms = absolute === null ? NaN : parseFloat(absolute);

        if (type === "insertion") {
            insertions.set(whenKey(ms, Number(extOf(when, "pitch"))), when);
        } else if (type === "substitution" && data) {
            substitutions.set(data, when);
            if (Number.isFinite(ms)) matched.set(data, ms);
        } else if (data && Number.isFinite(ms) && type !== "deletion" && type !== "sustain" && type !== "soft") {
            matched.set(data, ms);
            const length = parseFloat(extOf(when, "duration") ?? "");
            if (Number.isFinite(length)) released.set(data, ms + length);
        }
    }
    return { matched, released, insertions, substitutions };
}

/** Note on a `<when>` what it was before the transcription repointed it. */
function mark(doc: Document, when: Element, was: "insertion" | "substitution", writtenId?: string): void {
    const marker = doc.createElementNS(MEI_NS, "extData");
    marker.setAttribute("type", "transcribed");
    marker.textContent = was;
    when.appendChild(marker);
    if (writtenId) {
        const written = doc.createElementNS(MEI_NS, "extData");
        written.setAttribute("type", "transcribedFrom");
        written.textContent = `#${writtenId}`;
        when.appendChild(written);
    }
}

/** Put the `<when>`s back as the aligner wrote them. */
function revertWhens(doc: Document, source?: string): void {
    for (const marker of [...doc.querySelectorAll('extData[type="transcribed"]')]) {
        const when = marker.parentElement;
        if (!when) continue;
        if (source !== undefined && when.closest("recording")?.getAttribute("source") !== source) continue;

        const was = marker.textContent ?? "";
        const from = [...when.children].find(
            (child) => child.localName === "extData" && child.getAttribute("type") === "transcribedFrom",
        );
        if (was === "insertion") {
            when.removeAttribute("data");
            when.setAttribute("type", "insertion");
        } else {
            when.setAttribute("type", "substitution");
            if (from?.textContent) when.setAttribute("data", from.textContent);
        }
        from?.remove();
        marker.remove();
    }
}

/** The id the transcriber gives a note it writes for a played one, and the pitch in it. */
const PLAYED_ID = /^played-\d+ms-(\d+)$/;

/**
 * Put a recording that was saved in the as-played-by format back into the working form.
 *
 * The format has no record of a played note without a written one, and none of a written note
 * that was not played: both are in the score by then, as readings. So what the aligner had found
 * is read back off the score, once {@link revertTranscription} has taken the readings out again.
 *
 *   A record pointing at a note the transcriber wrote was a played note with no written one. The
 *   note is gone with its reading, and its id says at what pitch it was played.
 *
 *   A record pointing at the note a tie runs into was one too: the score holds that note and
 *   the performer struck it.
 *
 *   Several records on one note are a figure on that note. One of them is the note itself, the
 *   first that sounded at the written pitch, and the others were played around it. The first in
 *   the document, because that is where the aligner's own match stands, and choosing another
 *   would file a reader's decision about the figure under another name.
 *
 *   A written note no record points at was not played.
 *
 * Two things do not come back, and neither changes what is transcribed. A played note the
 * transcriber recognised as a written one is that note's match, and no longer something to
 * decide. And a played note the score had no place for at all was not saved.
 *
 * Only a saved recording is touched. It is known by its matches, which the format types as such
 * and the working form does not.
 */
function restoreWhens(doc: Document, source?: string): void {
    let written: ScoreModel["notes"] | undefined;
    let tieEnds: Set<string> | undefined;

    const dataOf = (when: Element, type: string): Element | undefined =>
        [...when.children].find((child) => child.localName === "extData" && child.getAttribute("type") === type);
    const give = (when: Element, type: string, value: string) => {
        if (dataOf(when, type)) return;
        const element = doc.createElementNS(MEI_NS, "extData");
        element.setAttribute("type", type);
        element.textContent = value;
        when.appendChild(element);
    };

    for (const recording of doc.querySelectorAll("recording")) {
        if (source !== undefined && recording.getAttribute("source") !== source) continue;
        const matches = [...recording.children].filter(
            (child) => child.localName === "when" && child.getAttribute("type") === "match",
        );
        if (matches.length === 0) continue;

        written ??= readScore(doc).notes;
        if (!tieEnds) {
            tieEnds = new Set();
            for (const tie of doc.querySelectorAll("tie")) {
                const to = tie.getAttribute("endid")?.replace(/^#/, "");
                if (to) tieEnds.add(to);
            }
        }

        /** Back to a played note with no written one, as settled as a saved document is. */
        const unwrite = (when: Element, pitch: number | undefined, anchor?: string) => {
            when.removeAttribute("data");
            when.setAttribute("type", "insertion");
            if (pitch !== undefined) give(when, "pitch", String(pitch));
            give(when, "confidence", "1.000");
            if (anchor) {
                give(when, "ornamentAnchor", `#${anchor}`);
                give(when, "ornamentAnchorFrom", "model");
            }
        };

        const byNote = new Map<string, Element[]>();
        for (const when of matches) {
            const id = when.getAttribute("data")?.replace(/^#/, "");
            if (!id) continue;

            const played = PLAYED_ID.exec(id);
            if (played) unwrite(when, Number(played[1]));
            else if (tieEnds.has(id)) unwrite(when, written.get(id)?.pitch);
            else {
                const together = byNote.get(id);
                if (together) together.push(when);
                else byNote.set(id, [when]);
            }
        }

        for (const [id, together] of byNote) {
            const sounds = written.get(id)?.pitch;
            const own =
                together.find((when) => Number(dataOf(when, "pitch")?.textContent ?? NaN) === sounds) ??
                together[0];
            for (const when of together) {
                if (when !== own) {
                    unwrite(when, undefined, id);
                    continue;
                }
                when.removeAttribute("type");
                dataOf(when, "pitch")?.remove();
            }
        }

        for (const note of doc.querySelectorAll("body note")) {
            const id = note.getAttribute("xml:id");
            // The note a tie runs into is not struck, so nothing was left out where it has no record
            if (!id || byNote.has(id) || tieEnds.has(id)) continue;
            const when = doc.createElementNS(MEI_NS, "when");
            when.setAttribute("data", `#${id}`);
            when.setAttribute("type", "deletion");
            give(when, "confidence", "1.000");
            recording.appendChild(when);
        }
    }
}

function cssEscape(value: string): string {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

export { SIGN_KINDS, type SignKind };
