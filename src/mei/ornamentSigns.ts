/**
 * The ornament signs a score already writes, keyed by the note each one decorates.
 *
 * `GenerateTimemapFunctor` adds one timemap entry per notated note and never
 * realises an ornament: the only expansion in verovio's MIDI code is
 * `m_expandedNotes`, which only `VisitBTrem` fills, so a `<trill>`, `<mordent>`
 * or `<turn>` contributes nothing.
 *
 * So a notated trill reaches the aligner as a single score note while the
 * recording holds the eight the performer played, and seven come back as
 * insertions. Without this they would all be reported as notes the performer
 * added, which in romantic piano music is the commonest such report and the
 * wrongest: the score does write them, once, as a sign.
 */

const MEI_NS = "http://www.music-encoding.org/ns/mei";

/** The signs worth telling apart when reading extra notes. */
export type OrnamentSignName = "trill" | "mordent" | "turn" | "ornam" | "arpeg";

const SIGN_NAMES: OrnamentSignName[] = ["trill", "mordent", "turn", "ornam", "arpeg"];

export interface OrnamentSign {
    name: OrnamentSignName;
    /** The element's own id, so a reading can point back at the sign it explains */
    id: string | null;
    /** @form, @place and the like, kept for display rather than interpreted */
    form: string | null;
}

/**
 * Every note a sign points at.
 *
 * A sign reaches its note in one of two ways, and both are in use: `@startid`
 * names the note outright, while `@staff` plus `@tstamp` names a beat and leaves
 * the note to be found. The second form is what most MusicXML conversions
 * produce, so resolving only `@startid` would miss a large part of the corpus.
 *
 * A note may carry more than one sign (a trill with a turned ending, say), so the
 * map holds every one of them.
 */
export function ornamentSigns(doc: Document): Map<string, OrnamentSign[]> {
    const signs = new Map<string, OrnamentSign[]>();

    const add = (noteId: string, sign: OrnamentSign) => {
        const existing = signs.get(noteId);
        if (existing) existing.push(sign);
        else signs.set(noteId, [sign]);
    };

    for (const name of SIGN_NAMES) {
        for (const element of doc.getElementsByTagNameNS(MEI_NS, name)) {
            const sign: OrnamentSign = {
                name,
                id: element.getAttribute("xml:id"),
                form: element.getAttribute("form") ?? element.getAttribute("place"),
            };

            for (const noteId of targetsOf(element, doc)) add(noteId, sign);
        }
    }

    return signs;
}

/** Read the signs straight out of an MEI string. */
export function ornamentSignsOf(mei: string): Map<string, OrnamentSign[]> {
    return ornamentSigns(new DOMParser().parseFromString(mei, "application/xml"));
}

/**
 * The notes one sign decorates.
 *
 * `@startid` may name a chord rather than a note, in which case every note of the
 * chord is decorated - an arpeggio always does this, and a trill on a chord is
 * written the same way.
 */
function targetsOf(sign: Element, doc: Document): string[] {
    const startid = sign.getAttribute("startid")?.replace(/^#/, "");
    if (startid) {
        const target = doc.querySelector(`[*|id="${cssEscape(startid)}"]`);
        if (!target) return [];
        return target.localName === "note" ? [startid] : noteIdsUnder(target);
    }

    // An <arpeg> names what it spreads with @plist rather than @startid, and it
    // may name several chords at once
    const plist = sign.getAttribute("plist");
    if (plist) {
        return plist
            .trim()
            .split(/\s+/)
            .flatMap((reference) => {
                const target = doc.querySelector(
                    `[*|id="${cssEscape(reference.replace(/^#/, ""))}"]`
                );
                if (!target) return [];
                return target.localName === "note"
                    ? [reference.replace(/^#/, "")]
                    : noteIdsUnder(target);
            });
    }

    const tstamp = sign.getAttribute("tstamp");
    const staff = sign.getAttribute("staff");
    if (!tstamp || !staff) return [];

    return notesAtTimestamp(sign, Number(tstamp), staff.trim().split(/\s+/));
}

/** Every <note> id at or under an element, itself included when it is one. */
function noteIdsUnder(element: Element): string[] {
    const ids: string[] = [];
    for (const note of element.getElementsByTagNameNS(MEI_NS, "note")) {
        const id = note.getAttribute("xml:id");
        if (id) ids.push(id);
    }
    return ids;
}

/**
 * The notes a `@staff`/`@tstamp` sign lands on.
 *
 * The timestamp is a beat within the sign's own measure, counting from 1. Rather
 * than reimplement verovio's duration arithmetic, the beat is compared against
 * the onsets the notation itself gives - the same walk `notatedOnsets` does - and
 * a note is taken when it falls within half a beat. That tolerance is what makes
 * the common case work without pretending to the precision of a real timemap:
 * signs sit on beats, and beats are far more than half a beat apart.
 */
function notesAtTimestamp(sign: Element, tstamp: number, staves: string[]): string[] {
    const measure = sign.closest("measure");
    if (!measure) return [];

    const ids: string[] = [];

    for (const staffEl of measure.getElementsByTagNameNS(MEI_NS, "staff")) {
        const n = staffEl.getAttribute("n");
        if (n !== null && !staves.includes(n)) continue;

        for (const layer of staffEl.getElementsByTagNameNS(MEI_NS, "layer")) {
            let beat = 1;
            for (const event of layer.children) {
                const beats = beatsOf(event);
                if (Math.abs(beat - tstamp) < 0.5) {
                    if (event.localName === "note") {
                        const id = event.getAttribute("xml:id");
                        if (id) ids.push(id);
                    } else if (event.localName === "chord") {
                        ids.push(...noteIdsUnder(event));
                    }
                }
                beat += beats;
            }
        }
    }

    return ids;
}

/**
 * How many beats an event occupies, from `@dur` and `@dots`.
 *
 * A beat is a quarter here, which is what `@tstamp` counts in a simple metre. In
 * a compound one the two drift apart; a sign whose note is missed for that reason
 * simply goes unrecognised, which costs a proposed reading and nothing else.
 */
function beatsOf(event: Element): number {
    if (event.localName === "beam" || event.localName === "tuplet") {
        let total = 0;
        for (const child of event.children) total += beatsOf(child);
        return total;
    }

    if (!["note", "chord", "rest", "space"].includes(event.localName)) return 0;
    // A grace note takes its time from the note it leans on, not from the bar
    if (event.hasAttribute("grace")) return 0;

    const dur = Number(event.getAttribute("dur"));
    if (!Number.isFinite(dur) || dur <= 0) return 0;

    const plain = 4 / dur;
    const dots = Number(event.getAttribute("dots")) || 0;
    return plain * (2 - Math.pow(2, -dots));
}

/** `CSS.escape` where the environment has it, which jsdom and every browser do. */
function cssEscape(value: string): string {
    return typeof CSS?.escape === "function" ? CSS.escape(value) : value;
}
