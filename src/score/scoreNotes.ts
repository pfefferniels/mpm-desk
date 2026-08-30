import { loadVerovio } from "../verovio/toolkit";
import { applyNotatedOnsets } from "./notatedOnsets";
import { impliedAlterations } from "./accidentals";

/** Every tie of the document, by the note it ends on and by the note it starts from */
const readTies = (meiDoc: Document) => {
    const tieInto = new Map<string, Element>();
    const tiedOn = new Map<string, string>();

    for (const tie of meiDoc.querySelectorAll("tie")) {
        const from = tie.getAttribute("startid")?.replace(/^#/, "");
        const to = tie.getAttribute("endid")?.replace(/^#/, "");

        if (to) tieInto.set(to, tie);
        if (from && to) tiedOn.set(from, to);
    }

    return { tieInto, tiedOn };
};

/** The last note of the tie chain this note starts, i.e. the one released */
const lastOfTie = (id: string, tiedOn: Map<string, string>): string => {
    const seen = new Set([id]);

    let last = id;
    for (;;) {
        const next = tiedOn.get(last);
        if (!next || seen.has(next)) return last;

        seen.add(next);
        last = next;
    }
};

/**
 * What has to be added to the pitch verovio reports for this note.
 *
 * Material verovio unfolds for itself - the second pass through a repeat - carries
 * an id the document does not have, `n1-rend2` from `n1` in `ExpansionMap`. The
 * notation it was unfolded from is what says how the note is altered, so the
 * alteration written down for the note it came from is the one it takes.
 */
const alterationOf = (id: string, alterations: Map<string, number>): number =>
    alterations.get(id) ?? alterations.get(id.replace(/-rend\d+$/, "")) ?? 0;

export type ScoreNote = {
    onset: number; // in quarter notes
    duration: number; // in quarter notes
    pitch: number; // MIDI pitch
    note: string; // MEI note ID
}

export type ScoreNoteOptions = {
    /**
     * Whether a pitch sounding twice at the same moment - a unison written in two
     * voices - is read as one note. An aligner that expects one score note per
     * performed note wants this; one that decides for itself which of the two was
     * not played wants both notes.
     */
    collapseUnisons?: boolean;

    /**
     * Whether notes are given the onset the score writes rather than the one
     * verovio would play them at. Verovio rolls an arpeggio and lets a grace note
     * take its time out of the note it leans on, which moves real notes away from
     * where they stand in the notation; see ./notatedOnsets.
     */
    notatedOnsets?: boolean;
}

/**
 * The notes of the score in the order they sound, as verovio reads them.
 *
 * Two things are always true of the result: a tied group counts as the single
 * note it sounds as, lasting until the end of the tie, and where the encoding
 * offers editorial readings the performance one is taken.
 */
export const getNotesFromMEI = async (
    mei: string,
    { collapseUnisons = true, notatedOnsets = false }: ScoreNoteOptions = {}
): Promise<ScoreNote[]> => {
    // Create symbolic notes
    const meiDoc = new DOMParser().parseFromString(mei, 'text/xml');
    const vrvToolkit = await loadVerovio();
    vrvToolkit.setOptions({
        appXPathQuery: ["./rdg[contains(@source, 'performance')]"],
    });
    vrvToolkit.loadData(mei);
    vrvToolkit.renderToMIDI();

    const timemap = vrvToolkit.renderToTimemap()

    // Asking the document and the timemap about one note at a time is a scan of
    // each per note; every question they are asked below is prepared here instead
    const { tieInto, tiedOn } = readTies(meiDoc);
    const releasedAt = new Map<string, number>();
    const struckAt = new Map<string, number>();
    for (const entry of timemap) {
        for (const note of entry.off ?? []) {
            if (!releasedAt.has(note)) releasedAt.set(note, entry.qstamp);
        }
        for (const note of entry.on ?? []) {
            if (!struckAt.has(note)) struckAt.set(note, entry.qstamp);
        }
    }

    // Needs the onsets: an accidental holds for the rest of its measure, and the
    // layers of a staff are written one after the other rather than in that order
    const alterations = impliedAlterations(meiDoc, struckAt);

    const notes = timemap
        .map(entry => {
            return (entry.on || []).map(note => {
                return {
                    qstamp: entry.qstamp,
                    note
                }
            })
        })
        .flat()
        .filter(entry => {
            const possibleTie = tieInto.get(entry.note);
            if (possibleTie) {
                if (possibleTie.closest('rdg')?.getAttribute('source') === 'original') {
                    return true;
                }
                return false;
            }
            return true;
        })
        .map(entry => {
            // A tie makes one sounding note out of the chain, and the row that
            // survives it is the one that starts it: it lasts until the last note
            // of the chain is released, not until its own written length is up
            const released = lastOfTie(entry.note, tiedOn);
            const offset = releasedAt.get(released) ?? entry.qstamp;
            const duration = offset - entry.qstamp;
            const { pitch } = vrvToolkit.getMIDIValuesForElement(entry.note);
            return {
                onset: entry.qstamp,
                duration,
                // Verovio never reads the key signature, so what it returns is the
                // note plus its own accidental and nothing else; see ./accidentals
                pitch: pitch + alterationOf(entry.note, alterations),
                note: entry.note
            }
        })

    // Before the unisons are weighed up, so that notes an arpeggio had spread are
    // compared at the one onset the chord is written at
    if (notatedOnsets) applyNotatedOnsets(notes, meiDoc);

    if (!collapseUnisons) return notes;

    return notes.filter((entry, index, arr) =>
        arr.findIndex(e => e.onset === entry.onset && e.pitch === entry.pitch) === index)
}
