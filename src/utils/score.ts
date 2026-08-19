/**
 * Note `xml:id` ⇒ symbolic date, read straight out of the score MSM.
 *
 * Playback reports the id of each sounding note (the MIDI carries it as a text
 * meta event); this is what turns that back into a position on the timeline.
 */
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
