/**
 * The score the viewer's band engraves: the transcription with its own performance marks taken
 * out, laid out along the tick axis the tree is drawn on.
 *
 * The band shows what the reconstruction says about the performance, so nothing the edition
 * prints may compete with it — a slur or a hairpin in the notation would read as one of the
 * reconstruction's signs. What is kept is what says which notes there are: notes, rests, ties,
 * beams, accidentals, clefs and the like.
 *
 * The tick axis comes from the fork's performed layout, which places every note at the time a
 * `<recording>` gives for it. A recording that gives each note its *notated* date, one
 * millisecond per tick, makes that layout linear in ticks, and `performanceScale` then sets how
 * wide a tick is. So the document is prepared once and every zoom is only a re-engraving.
 */
const MEI_NS = 'http://www.music-encoding.org/ns/mei';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** The recording the band is laid out by, as `@xml:id` and `@source`. */
export const SYMBOLIC_RECORDING = 'symbolic';

/**
 * The elements that tell a performer how to play rather than what to play.
 *
 * Trills, mordents and turns are not here: they say which notes sound, and the reconstruction
 * has no instruction that would take their place.
 */
const PERFORMANCE_MARKS = [
    'slur', 'phrase', 'hairpin', 'dynam', 'dir', 'tempo', 'pedal', 'fermata',
    'artic', 'arpeg', 'breath', 'caesura', 'lv',
] as const;

/** The same marks written as attributes of a note or chord. */
const PERFORMANCE_ATTRIBUTES = ['artic', 'artic.ges', 'fermata'];

/** A note of the MSM, the score the performance is rendered against. */
export interface ScoreNote {
    id: string;
    date: number;
    duration: number;
}

export const readScoreNotes = (msmXml: string): ScoreNote[] => {
    const doc = new DOMParser().parseFromString(msmXml, 'application/xml');
    const notes: ScoreNote[] = [];
    for (const note of doc.querySelectorAll('note')) {
        const id = note.getAttribute('xml:id');
        const date = Number(note.getAttribute('date'));
        const duration = Number(note.getAttribute('duration'));
        if (id && Number.isFinite(date)) notes.push({ id, date, duration: Number.isFinite(duration) ? duration : 0 });
    }
    return notes;
};

/** What preparing the band's MEI took out, for the record and for the tests. */
interface PreparedBand {
    mei: string;
    removed: Record<string, number>;
}

export const prepareBandMei = (mei: string, notes: readonly ScoreNote[]): PreparedBand => {
    const doc = new DOMParser().parseFromString(mei, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('The MEI could not be read');

    const removed: Record<string, number> = {};
    for (const name of PERFORMANCE_MARKS) {
        const found = [...doc.getElementsByTagNameNS(MEI_NS, name)];
        for (const element of found) element.remove();
        if (found.length) removed[name] = found.length;
    }
    for (const element of doc.getElementsByTagNameNS(MEI_NS, '*')) {
        for (const name of PERFORMANCE_ATTRIBUTES) element.removeAttribute(name);
    }

    const music = doc.getElementsByTagNameNS(MEI_NS, 'music')[0];
    if (!music) throw new Error('The MEI has no <music>');
    let performance = doc.getElementsByTagNameNS(MEI_NS, 'performance')[0] as Element | undefined;
    if (!performance) {
        performance = doc.createElementNS(MEI_NS, 'performance');
        music.appendChild(performance);
    }

    const recording = doc.createElementNS(MEI_NS, 'recording');
    recording.setAttributeNS(XML_NS, 'xml:id', SYMBOLIC_RECORDING);
    recording.setAttribute('source', SYMBOLIC_RECORDING);
    for (const note of notes) {
        // One millisecond per tick: `performanceScale` does the rest.
        const when = doc.createElementNS(MEI_NS, 'when');
        when.setAttribute('absolute', `${String(note.date)}ms`);
        when.setAttribute('abstype', 'smil');
        when.setAttribute('data', `#${note.id}`);
        const duration = doc.createElementNS(MEI_NS, 'extData');
        duration.setAttribute('type', 'duration');
        duration.textContent = `${String(note.duration)}ms`;
        when.appendChild(duration);
        recording.appendChild(when);
    }
    performance.insertBefore(recording, performance.firstChild);

    return { mei: new XMLSerializer().serializeToString(doc), removed };
};
