import type { ScoreNote } from "./scoreNotes";

/**
 * Verovio times a score the way it would play it: an arpeggio is rolled, and a
 * grace note is placed off the beat, which leaves notes standing somewhere other
 * than where the notation writes them.
 *
 * Where the document says what it writes, that is used. MEI converted from
 * MusicXML carries @dur.ppq on every timed event - zero on a grace - and @ppq on
 * the staffDef, and accumulating those through a layer gives the notated position
 * of every note without going through played time at all. MEI written as MEI
 * usually carries neither, and verovio does not add them, so for those documents
 * only the arpeggios can be put right, from the markup that rolled them.
 */
export function applyNotatedOnsets(notes: ScoreNote[], meiDoc: Document): void {
    const rows = new Map(notes.map((note) => [note.note, note]));
    const notated = readNotatedTiming(meiDoc);

    if (notated.size === 0) {
        console.warn(
            "notatedOnsets: this MEI carries no @dur.ppq, so only arpeggios can be "
                + "put back; grace notes keep the position verovio would play them at"
        );
    }

    for (const [id, timing] of notated) {
        const row = rows.get(id);
        // Material verovio unfolds for itself carries ids the document does not
        // have; nothing is written down for those, so they keep the played timing
        if (!row) continue;

        row.onset = timing.onset;
        row.duration = timing.duration;
    }

    // Harmless where the notated timing has already placed them together
    unrollArpeggios(rows, meiDoc);
}

interface Timing {
    onset: number;
    duration: number;
}

/** What the score writes, in quarter notes, keyed by the xml:id of the note */
function readNotatedTiming(meiDoc: Document): Map<string, Timing> {
    const timing = new Map<string, Timing>();
    if (!meiDoc.querySelector("[dur\\.ppq]")) return timing;

    const ppqOf = ppqReader(meiDoc);

    let measureStart = 0;
    for (const measure of meiDoc.querySelectorAll("measure")) {
        let measureLength = 0;

        for (const staff of measure.querySelectorAll("staff")) {
            const ppq = ppqOf(staff);

            for (const layer of staff.querySelectorAll("layer")) {
                let at = 0;

                for (const event of timedEvents(layer)) {
                    const written = Number(event.getAttribute("dur.ppq"));
                    const duration = Number.isFinite(written) ? written : 0;

                    for (const note of notesOf(event)) {
                        const id = note.getAttribute("xml:id");
                        if (id) {
                            timing.set(id, {
                                onset: (measureStart + at) / ppq,
                                duration: duration / ppq,
                            });
                        }
                    }

                    at += duration;
                }

                measureLength = Math.max(measureLength, at);
            }
        }

        measureStart += measureLength;
    }

    mergeTies(timing, meiDoc);
    return timing;
}

/** What takes time in a layer. A chord times its notes, so it stands for them. */
const TIMED = new Set(["note", "chord", "rest", "space", "mRest", "mSpace"]);

/**
 * Everything that takes time under `layer`, in the order it is written.
 *
 * Walked rather than selected, because the order is the whole of the arithmetic above and a
 * selector list does not reliably give it. `querySelectorAll` is specified to answer in tree
 * order and a browser does — but jsdom's engine answers a *list* grouped by selector, so a layer
 * written `<space/><note/><note/><note/>` comes back as note, note, note, space and every note in
 * it lands half a beat early. Measured on `chopin-op38-mm18-22.mei`, where it moved eight notes
 * of the two layers that hold a `<space>`.
 *
 * The walk stops at a timed element, so a chord's own notes are not visited: that is what the
 * `closest("chord")` guard used to say at the call site, and it says it once here instead.
 */
function timedEvents(layer: Element): Element[] {
    const events: Element[] = [];

    const visit = (element: Element) => {
        for (const child of element.children) {
            if (TIMED.has(child.localName)) events.push(child);
            else visit(child);
        }
    };

    visit(layer);
    return events;
}

/** The staff's own ppq, or whatever the document declares */
function ppqReader(meiDoc: Document): (staff: Element) => number {
    const fallback = Number(meiDoc.querySelector("[ppq]")?.getAttribute("ppq")) || 1;

    return (staff) => {
        const n = staff.getAttribute("n");
        const declared = n
            ? meiDoc.querySelector(`staffDef[n="${n}"][ppq]`)?.getAttribute("ppq")
            : undefined;

        return Number(declared) || fallback;
    };
}

const notesOf = (event: Element): Element[] =>
    event.localName === "note"
        ? [event]
        : event.localName === "chord"
          ? [...event.querySelectorAll("note")]
          : [];

/**
 * A note tied to the next one sounds as one note for the two of them, and the
 * duration written on it alone is not what it lasts. The note being tied into is
 * dropped from the score notes, so the whole chain is added to the note that
 * starts it.
 */
function mergeTies(timing: Map<string, Timing>, meiDoc: Document): void {
    const tiedTo = new Map<string, string>();
    for (const tie of meiDoc.querySelectorAll("tie[startid][endid]")) {
        const from = tie.getAttribute("startid")!.replace(/^#/, "");
        const to = tie.getAttribute("endid")!.replace(/^#/, "");
        if (from && to) tiedTo.set(from, to);
    }

    const held = (id: string, seen: Set<string>): number => {
        const own = timing.get(id)?.duration ?? 0;
        const next = tiedTo.get(id);
        if (!next || seen.has(next)) return own;

        seen.add(next);
        return own + held(next, seen);
    };

    for (const [from] of tiedTo) {
        const start = timing.get(from);
        if (start) start.duration = held(from, new Set([from]));
    }
}

/** The notes an <arpeg> covers, following @plist and @startid into chords */
function membersOf(arpeg: Element, meiDoc: Document): Element[] {
    const references = [
        ...(arpeg.getAttribute("plist") ?? "").split(/\s+/),
        arpeg.getAttribute("startid") ?? "",
    ]
        .map((reference) => reference.replace(/^#/, ""))
        .filter(Boolean);

    return references.flatMap((id) => {
        const element = meiDoc.querySelector(`[*|id="${id}"]`);
        if (!element) return [];

        return element.localName === "note" ? [element] : [...element.querySelectorAll("note")];
    });
}

/** Give every note of an arpeggiated chord the onset the chord is written at */
function unrollArpeggios(rows: Map<string, ScoreNote>, meiDoc: Document): void {
    for (const arpeg of meiDoc.querySelectorAll("arpeg")) {
        const members = membersOf(arpeg, meiDoc)
            .map((note) => rows.get(note.getAttribute("xml:id") ?? ""))
            .filter((row): row is ScoreNote => row !== undefined);

        if (members.length < 2) continue;

        const onset = Math.min(...members.map((member) => member.onset));
        for (const member of members) {
            // The roll shortens each note as it delays it; both are undone here
            member.duration = member.onset + member.duration - onset;
            member.onset = onset;
        }
    }
}
