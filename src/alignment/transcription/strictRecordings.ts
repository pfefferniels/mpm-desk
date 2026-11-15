/**
 * A document's recordings as the as-played-by format has them.
 *
 * While a reader is at work the recording holds more than the format allows: the notes the
 * aligner found no written note for, the written notes it found nothing played for, and a mark
 * on every record the transcriber repointed. That is the desk's working form, and it is what
 * lets a change of mind be a new transcription rather than a patch (see `./index`).
 *
 * None of it leaves the desk. In the format a `<when>` is a note that sounded or a pedal press:
 * it names the written note in `@data` and the moment in `@absolute`, and what the performer
 * did differently is in the score, as a reading. A written note nothing points at was not
 * played, so a deletion needs no record. A played note the score has no note for has none
 * either, and by the time a document is saved the transcriber has written those into it.
 *
 * An ornament is the one place that is not one to one. Several records on one note are that
 * note played as an ornament, each with the pitch that sounded. That is what becomes of a
 * figure the score writes as a sign, its own or one the transcriber put there: its notes point
 * at the note the sign stands on.
 *
 * https://github.com/pfefferniels/as-played-by
 */

import { ornamentSignsOf } from "../../mei/ornamentSigns";
import { readScore } from "./scoreModel";
import { revertTranscription } from "./write";

const MEI_NS = "http://www.music-encoding.org/ns/mei";

/** What the record of a sounded note may carry beside its moment. */
const NOTE_DATA = new Set(["velocity", "duration", "pitch", "onsetTicks", "durationTicks"]);

/** The signs that stand for notes the score does not write out. An arpeggio writes all of its. */
const FIGURE_SIGNS = new Set(["trill", "mordent", "turn", "ornam"]);

const dataOf = (when: Element, type: string): Element | undefined =>
    [...when.children].find(
        (child) => child.localName === "extData" && child.getAttribute("type") === type,
    );

/**
 * The document with every recording in the format's form.
 *
 * Applied to a document that already is, it changes nothing.
 */
export function strictRecordings(mei: string): string {
    if (!mei.includes("recording")) return mei;

    const doc = new DOMParser().parseFromString(mei, "application/xml");
    const signs = ornamentSignsOf(mei);

    // What each written note sounds as, read the way the transcriber reads it: with the key
    // signature and with the accidentals that hold to the barline. Off the source, where every
    // note a figure can stand on is
    const source = new DOMParser().parseFromString(mei, "application/xml");
    revertTranscription(source);
    const written = readScore(source).notes;

    const notes = new Set<string>();
    for (const note of doc.getElementsByTagNameNS(MEI_NS, "note")) {
        const id = note.getAttribute("xml:id");
        if (id) notes.add(id);
    }

    /** Whether the score writes this note with a sign that a figure can be the playing of. */
    const signed = (id: string): boolean =>
        (signs.get(id) ?? []).some((sign) => FIGURE_SIGNS.has(sign.name));

    for (const recording of doc.getElementsByTagNameNS(MEI_NS, "recording")) {
        const byNote = new Map<string, Element[]>();

        for (const when of [...recording.children]) {
            if (when.localName !== "when") continue;
            const type = when.getAttribute("type");
            if (type === "sustain" || type === "soft") continue;

            // Nothing points at a note that was not played, which is how the format says so
            if (type === "deletion") {
                when.remove();
                continue;
            }

            if (type === "insertion") {
                // A played note the score still has no note for. Where it is one of a figure
                // the score writes as a sign, it is that sign being played and points at the
                // note the sign stands on. Anything else has no place in the format
                const anchor = dataOf(when, "ornamentAnchor")?.textContent?.trim().replace(/^#/, "");
                if (!anchor || !notes.has(anchor) || !signed(anchor) || !when.hasAttribute("absolute")) {
                    when.remove();
                    continue;
                }
                when.setAttribute("data", `#${anchor}`);
            }

            const target = when.getAttribute("data")?.replace(/^#/, "");
            // Neither a pedal nor a note this document holds: not this function's to judge
            if (!target || !when.hasAttribute("absolute")) continue;

            when.setAttribute("type", "match");
            for (const child of [...when.children]) {
                if (child.localName !== "extData") continue;
                if (!NOTE_DATA.has(child.getAttribute("type") ?? "")) child.remove();
            }

            const together = byNote.get(target);
            if (together) together.push(when);
            else byNote.set(target, [when]);
        }

        for (const [id, together] of byNote) {
            // One record on a note is that note, at the pitch the score writes
            if (together.length === 1) {
                dataOf(together[0], "pitch")?.remove();
                continue;
            }

            // Several are the note played as an ornament, and each says what sounded. The
            // note's own record came as a match and never had to: the score gave its pitch
            const sounds = written.get(id)?.pitch;
            for (const when of together) {
                if (dataOf(when, "pitch") || sounds === undefined) continue;
                const pitch = doc.createElementNS(MEI_NS, "extData");
                pitch.setAttribute("type", "pitch");
                pitch.textContent = String(sounds);
                when.insertBefore(pitch, when.firstChild);
            }
        }
    }

    return new XMLSerializer().serializeToString(doc);
}
