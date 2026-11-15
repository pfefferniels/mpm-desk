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
 * says how it is done and after whom. The rest is notation: which staff (`./place`), what the
 * pitch is called (`./spell`), and how the answer is written without disturbing a single note
 * that was already there (`./write`).
 *
 * The transcription is a function of the source score, the alignment and the reader's choices,
 * and of nothing else. So a change of mind is not a patch: the document is taken back to its
 * source and transcribed again.
 */

import type { NoteSpan } from "../../performance/midiSpans";
import type { Divergence } from "../divergences";
import { signFor } from "./figure";
import { UNITS, levelOf } from "./grid";
import { chooseStaff, chooseValue, joinable, valuesAt } from "./place";
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
import { buildTimeMap, localPace, type TimeMap } from "./timeMap";
import {
    applyEdits,
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
    /** Not at all: the recording keeps it and the score does not show it */
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
}

/** One played note as it stands in the score, and what a reader may do to it. */
export interface WrittenNoteInfo {
    id: string;
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
    /** What the reader has changed about single notes, by the id the note is written under */
    edits?: ReadonlyMap<string, NoteEdit>;
    /** Who answers for the readings */
    resp?: string;
    settings?: Partial<QuantiseSettings>;
}

interface Transcribed {
    mei: string;
    outcomes: Map<string, Outcome>;
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

    const model = readScore(doc);
    const recording = doc.querySelector(`recording[source="${cssEscape(input.source)}"]`);
    const outcomes = new Map<string, Outcome>();
    const choice = (id: string): Notation => input.choices?.get(id) ?? "auto";

    if (!recording) {
        return { mei: input.mei, outcomes };
    }

    const whens = indexWhens(recording);
    const map = buildTimeMap(
        [...whens.matched].flatMap(([id, ms]) => {
            const note = model.notes.get(id);
            return note && !note.event.grace ? [{ onset: note.event.onset, ms, pitch: note.pitch }] : [];
        }),
    );

    const spanById = new Map(input.spans.map((span) => [span.id, span]));
    const events = new Map<ScoreEvent, EventEdit>();
    const staves = new Map<StaffModel, StaffAddition>();
    const edits: Edits = { events: [], staves: [], signs: [] };
    const ids = new Set<string>();

    const editOf = (event: ScoreEvent): EventEdit => {
        let edit = events.get(event);
        if (!edit) {
            edit = { event, add: [], remove: [], replace: new Map(), graces: [] };
            events.set(event, edit);
            edits.events.push(edit);
        }
        return edit;
    };

    const newNote = (span: NoteSpan, group: string, reason: string, confidence: number, staff: StaffModel, onset: number): NewNote => {
        // Two keys of one pitch cannot go down in the same millisecond, so this is one note
        const id = writtenIdOf(span);
        ids.add(id);
        return {
            id,
            pitch: span.pitch,
            spelling: spell(span.pitch, { key: staff.key, around: around(model, staff.measure, onset) }),
            group,
            reason,
            confidence,
        };
    };

    // ---- What was played and is not written ----

    const played: Played[] = [];
    const groupOf = new Map<string, Extract<Divergence, { kind: "added" }>>();
    const forced = new Map<string, "measured" | "grace">();

    for (const divergence of input.divergences) {
        if (divergence.kind !== "added") continue;
        const asked = choice(divergence.id);
        const offers = offersFor(divergence);

        if (asked === "none") {
            outcomes.set(divergence.id, none("Left in the recording, as asked.", offers));
            continue;
        }
        if (asked === "auto" && NOT_THE_TEXT.has(divergence.reading)) {
            outcomes.set(divergence.id, none(WHY_NOT[divergence.reading] ?? "Not part of the text.", offers));
            continue;
        }
        if (asked === "sign") {
            const anchor = divergence.anchorId ? model.notes.get(divergence.anchorId) : undefined;
            if (anchor) {
                const sign = signFor(divergence.pitches, anchor.pitch);
                edits.signs.push({ anchor, sign, group: divergence.id, confidence: 1 });
                outcomes.set(divergence.id, {
                    written: "sign",
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
            played.push({ id: span.id, onsetMs: span.onsetMs, offsetMs: span.offsetMs, pitch: span.pitch, velocity: span.velocity });
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
    const fates = new Map<string, { kind: "measured" | "grace" | "unplaced"; confidence: number; where?: string; because?: string }[]>();
    const fate = (group: string, entry: { kind: "measured" | "grace" | "unplaced"; confidence: number; where?: string; because?: string }) => {
        const list = fates.get(group);
        if (list) list.push(entry);
        else fates.set(group, [entry]);
    };

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
            let addition = staves.get(staff);
            if (!addition) {
                addition = { staff, places: [] };
                staves.set(staff, addition);
                edits.staves.push(addition);
            }
            const own = newNote(span, divergence.id, divergence.reading, confidence, staff, onset);
            const place: OwnPlace = {
                start,
                // Settled below, once every note of the bar has its place
                value: chooseValue(start, Infinity, measure),
                notes: [own],
                graces: leaned ? [] : graceNotes(leaning, staff, onset),
            };
            places.set(about(own, staff), place);
            leaned = true;
            addition.places.push(place);
            fate(divergence.id, { kind: "measured", confidence, where: `${where}, in a voice of its own` });
        }

        function graceNotes(graces: typeof waiting, staff: StaffModel, at: number): NewNote[][] {
            return graces.map((grace) =>
                grace.moment.map(({ span, divergence, confidence }) => {
                    fate(divergence.id, { kind: "grace", confidence, where: describe(model, at) });
                    const note = newNote(span, divergence.id, divergence.reading, confidence, staff, at);
                    inform(divergence.id, {
                        id: note.id,
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

    // How long each note of its own is written: up to the next thing in its hand, which may be
    // a written note or another one just placed
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

    for (const [group, list] of fates) {
        const divergence = input.divergences.find((candidate) => candidate.id === group);
        if (!divergence || divergence.kind !== "added") continue;
        const outcome = summarise(list, offersFor(divergence));
        outcome.notes = infos.get(group) ?? [];
        outcome.measure = outcome.notes[0]?.measure;
        outcomes.set(group, outcome);
    }

    // ---- What is written and was not played ----

    const tiedOn = new Map<string, string>();
    for (const tie of doc.querySelectorAll("tie")) {
        const from = tie.getAttribute("startid")?.replace(/^#/, "");
        const to = tie.getAttribute("endid")?.replace(/^#/, "");
        if (from && to) tiedOn.set(from, to);
    }

    for (const divergence of input.divergences) {
        if (divergence.kind !== "missing") continue;
        const offers: Notation[] = ["auto", "none"];
        const asked = choice(divergence.id);

        if (asked === "none") {
            outcomes.set(divergence.id, none("Left as written, as asked.", offers));
            continue;
        }
        if (divergence.reading === "outside") {
            outcomes.set(divergence.id, none("Beyond where the recording reaches, so not something the performer left out.", offers));
            continue;
        }

        const notes = divergence.scoreIds.flatMap((id) => {
            const note = model.notes.get(id);
            return note ? [note] : [];
        });
        if (notes.length === 0) {
            outcomes.set(divergence.id, none("The notes are not in this reading of the score.", offers));
            continue;
        }

        if (asked === "auto" && isCut(notes, map)) {
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
        for (const note of notes) {
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
            if (twin && asked === "auto") {
                doubled++;
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
            omitted === 0
                ? none("A unison written in two voices and played as the one key it is. Nothing was left out.", offers)
                : {
                      written: "omitted",
                      because:
                          `${omitted === 1 ? "The note is" : `${String(omitted)} notes are`} taken out of the performance reading` +
                          (doubled > 0 ? `; ${String(doubled)} more are unisons the other voice played.` : "."),
                      offers,
                      noteIds: [],
                      notes: [],
                  },
        );
        const kept = outcomes.get(divergence.id);
        if (kept) kept.measure = notes[0].event.layer.staff.measure.index;
    }

    // ---- What was played at another pitch ----

    const mended: { scoreId: string; newId?: string }[] = [];
    for (const divergence of input.divergences) {
        if (divergence.kind !== "replaced") continue;
        const offers: Notation[] = ["auto", "as-written", "none"];
        const asked = choice(divergence.id);

        if (asked === "none") {
            outcomes.set(divergence.id, none("Left as written, as asked.", offers));
            continue;
        }

        const note = model.notes.get(divergence.scoreId);
        const span = spanById.get(divergence.perfId);
        if (!note || !span) {
            outcomes.set(divergence.id, none("The note is not in this reading of the score.", offers));
            continue;
        }

        if (asked === "as-written" || divergence.reading === "unmatched-pair") {
            mended.push({ scoreId: note.id });
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
        mended.push({ scoreId: note.id, newId: played.id });
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
    for (const note of edits.events.flatMap((edit) => [...edit.add, ...edit.graces.flat()]).concat(edits.staves.flatMap((addition) => addition.places.flatMap((place) => [...place.notes, ...place.graces.flat()])))) {
        const when = whens.insertions.get(whenKey(Number(/^played-(\d+)ms/.exec(note.id)?.[1] ?? NaN), note.pitch));
        if (!when) continue;
        when.setAttribute("data", `#${note.id}`);
        when.removeAttribute("type");
        mark(doc, when, "insertion");
    }
    for (const { scoreId, newId } of mended) {
        const when = whens.substitutions.get(scoreId);
        if (!when) continue;
        when.removeAttribute("type");
        mark(doc, when, "substitution", scoreId);
        if (newId) when.setAttribute("data", `#${newId}`);
    }

    return { mei: new XMLSerializer().serializeToString(doc), outcomes };
}

/** The score with every transcribed reading taken out again and the recording as the aligner left it. */
export function untranscribed(mei: string, source?: string): string {
    if (!mei.includes(`type="transcription"`) && !mei.includes(`type="transcribed"`)) return mei;
    const doc = new DOMParser().parseFromString(mei, "application/xml");
    revertWhens(doc, source);
    revertTranscription(doc);
    return new XMLSerializer().serializeToString(doc);
}

// ---------------------------------------------------------------------------------------------

/** Readings that are not the performer changing the text, and so are not written unasked. */
const NOT_THE_TEXT = new Set(["written-ornament", "outside", "repeat-pass"]);

const WHY_NOT: Record<string, string> = {
    "written-ornament":
        "The score writes an ornament sign on this note, and these are that ornament being played. " +
        "The text already has it.",
    outside: "Played before the first or after the last note the score accounts for.",
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
    if (divergence.reading === "written-ornament") return ["auto", "none"];
    const figure =
        divergence.anchorId !== null &&
        (divergence.reading === "ornamentation" || divergence.perfIds.length > 1);
    return ["auto", "measured", "grace", ...(figure ? (["sign"] as Notation[]) : []), "none"];
};

const none = (because: string, offers: Notation[]): Outcome => ({
    written: "none",
    because,
    offers,
    noteIds: [],
    notes: [],
});

function summarise(
    list: { kind: "measured" | "grace" | "unplaced"; confidence: number; where?: string; because?: string }[],
    offers: Notation[],
): Outcome {
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
        because: `${what}.${doubt}` + (left > 0 ? ` ${String(left)} more could not be placed.` : ""),
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
        }
    }
    return { matched, insertions, substitutions };
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

function cssEscape(value: string): string {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

