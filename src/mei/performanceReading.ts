import { readableChildren } from "../score/accidentals";

/**
 * The score with every `<app>` settled: only the reading that was played is left.
 *
 * Two readers have to agree about which notes the score has. Verovio is told which reading to
 * take, the performance one, and engraves, times and aligns that. espressivo, which makes the
 * MSM the chain fits, is not told: its converter takes a `<lem>` or else the *first* `<rdg>`,
 * and the first is the source's. Handed the document as it stands it would build a score without
 * the notes the performer added, and every `<when>` pointing at one of them would time nothing,
 * so that what the alignment desk wrote into the score never reached the performance.
 *
 * So the choice is made here, once, by the rule verovio follows (`readableChildren`), and the
 * converter is handed a document that has no choice left in it.
 *
 * Every `<supplied>` is given up as well, its content kept where it stood. What it says, that the
 * editor wrote what was played this way and why, is nothing the converter has a use for, and its
 * being there is something the converter cannot take: it times a `<layer>` against the layers
 * beside it, and one standing inside a `<supplied>` has none, so that it would start where the
 * staff's other voices end instead of at the barline.
 *
 * Only for conversion. The document itself keeps both readings: this returns a copy.
 */
export function performanceReading(mei: string): string {
    if (!mei.includes("<app") && !mei.includes("<supplied")) return mei;

    const doc = new DOMParser().parseFromString(mei, "application/xml");
    if (doc.querySelector("parsererror")) return mei;

    // Innermost first, so that a reading holding another `<app>` is settled before it is moved
    const apps = [...doc.querySelectorAll("app")].reverse();
    for (const app of apps) {
        const parent = app.parentNode;
        if (!parent) continue;
        for (const reading of readableChildren(app)) {
            for (const child of [...reading.childNodes]) parent.insertBefore(child, app);
        }
        parent.removeChild(app);
    }

    for (const supplied of [...doc.querySelectorAll("supplied")].reverse()) {
        const parent = supplied.parentNode;
        if (!parent) continue;
        for (const child of [...supplied.childNodes]) parent.insertBefore(child, supplied);
        parent.removeChild(supplied);
    }

    return new XMLSerializer().serializeToString(doc);
}
