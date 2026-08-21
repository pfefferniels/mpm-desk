/**
 * Note `xml:id` ⇒ symbolic date, read straight out of the score MSM.
 *
 * Playback reports the id of each sounding note (the MIDI carries it as a text
 * meta event); this is what turns that back into a position on the timeline.
 */
/**
 * The tick grid and the metre the score is counted in.
 *
 * Both are needed to turn an `<accentuationPattern>`'s `@length` into ticks:
 * espressivo counts it in beats relative to the time-signature denominator, so
 * `length * 4 * ppq / denominator` — not a constant, even though this score
 * happens to be 720/4 throughout.
 */
export interface Meter {
    ppq: number;
    denominator: number;
}

const DEFAULT_METER: Meter = { ppq: 720, denominator: 4 };

export const readMeter = (msmXml: string): Meter => {
    const doc = new DOMParser().parseFromString(msmXml, 'application/xml');
    const ppq = Number(doc.querySelector('msm')?.getAttribute('pulsesPerQuarter'));
    const denominator = Number(doc.querySelector('timeSignature')?.getAttribute('denominator'));
    return {
        ppq: Number.isFinite(ppq) && ppq > 0 ? ppq : DEFAULT_METER.ppq,
        denominator: Number.isFinite(denominator) && denominator > 0 ? denominator : DEFAULT_METER.denominator,
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
