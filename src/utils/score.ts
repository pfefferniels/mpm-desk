import { timeSignatureAt, type DatedTimeSignature } from '../fitting/timeSignature';

/**
 * Note `xml:id` ⇒ symbolic date, read straight out of the score MSM.
 *
 * Playback reports the id of each sounding note (the MIDI carries it as a text
 * meta event); this is what turns that back into a position on the timeline.
 */
/**
 * The tick grid, and the metre the score is counted in.
 *
 * The whole `<timeSignatureMap>` rather than one entry of it: a score with an
 * anacrusis states the upbeat bar first, and reading that as the metre puts one
 * bar's signature over the piece (issue #22). What a reader wants of it is the
 * beat at a date — {@link beatTicksAt}.
 */
export interface Meter {
    ppq: number;
    /** Ascending by date, and empty where the score states nothing. */
    signatures: DatedTimeSignature[];
}

const DEFAULT_PPQ = 720;

/** What a score that states no signature is counted in, and what espressivo renders it under. */
const COMMON_TIME_DENOMINATOR = 4;

/**
 * The score's `<timeSignatureMap>`, entry by entry.
 *
 * The first map that states anything, which in an MSM converted from MEI is `<global>`'s where
 * there is one and part 1's otherwise — espressivo's export copies the same map into every part.
 * One map for the whole score, so a document whose parts were metrically different would have
 * nowhere to put the difference; no reader here asks per part.
 */
export const readTimeSignatures = (msm: Document): DatedTimeSignature[] => {
    const map = [...msm.querySelectorAll('timeSignatureMap')]
        .find(candidate => candidate.querySelector('timeSignature'));

    return [...(map?.querySelectorAll('timeSignature') ?? [])].map(element => ({
        date: Number(element.getAttribute('date') || 0),
        numerator: Number(element.getAttribute('numerator') || 4),
        denominator: Number(element.getAttribute('denominator') || COMMON_TIME_DENOMINATOR),
    }));
};

/**
 * One beat in ticks at `date`: the unit an `<accentuationPattern>`'s `@length` is counted in,
 * and the grid a drawn axis is ruled on.
 *
 * Four of them to the whole note, over the denominator in force — the same arithmetic
 * espressivo's `MetricalAccentuationMap` makes when it renders the pattern.
 */
export const beatTicksAt = (meter: Meter, date: number): number =>
    (4 * meter.ppq) /
    (timeSignatureAt(meter.signatures, date)?.denominator ?? COMMON_TIME_DENOMINATOR);

export const readMeter = (msmXml: string): Meter => {
    const doc = new DOMParser().parseFromString(msmXml, 'application/xml');
    const ppq = Number(doc.querySelector('msm')?.getAttribute('pulsesPerQuarter'));
    return {
        ppq: Number.isFinite(ppq) && ppq > 0 ? ppq : DEFAULT_PPQ,
        signatures: readTimeSignatures(doc),
    };
};

export const readNoteDates = (msmXml: string): Map<string, number> => {
    const doc = new DOMParser().parseFromString(msmXml, 'application/xml');
    const dates = new Map<string, number>();
    for (const note of doc.querySelectorAll('note')) {
        const id = note.getAttribute('xml:id');
        const date = note.getAttribute('date');
        if (id && date !== null) dates.set(id, Number(date));
    }
    return dates;
};
