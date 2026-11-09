/**
 * Finding the same moment in two renderings of the same performance.
 *
 * Exaggeration rescales time — the piece runs 159 s at rest and 192 s at the ceiling — so a
 * transport second means something different in every rendering. What does not move is note
 * identity: espressivo emits one text meta event per note-on carrying the note's `xml:id`, and the
 * set of ids is invariant across settings. So two renderings are glued at a *note*, never at a time.
 *
 * That convention is espressivo's, which is why this lives here and not in `react-pianosound`: the
 * library's half of the seam is an `Anchor`, a moment named in both time bases.
 */
import type { AbsoluteEvent, Anchor, Schedule } from 'react-pianosound';

/** espressivo emits this literal for notes with no `xml:id` — never a usable anchor. */
export const UNIDENTIFIED_NOTE = 'unknown';

/** Note `xml:id` ⇒ absolute ms, for every identified note-on in a rendering. */
export function indexNoteIds(events: readonly AbsoluteEvent[]): Map<string, number> {
    const index = new Map<string, number>();
    for (const event of events) {
        if (event.type !== 'meta' || event.subtype !== 'text') continue;
        if (event.text === UNIDENTIFIED_NOTE) continue;
        // A repeated id would be a bake bug; the first occurrence is the note.
        if (!index.has(event.text)) index.set(event.text, event.abs);
    }
    return index;
}

/**
 * The first note onset in `outgoing` at or after `notBeforeSeconds` that `incoming` also has.
 *
 * Normally that is the very first candidate, since the id sets match. Returns `null` past the last
 * shared note, which is the caller's cue to let the current rendering play out rather than
 * reaching for a restart.
 */
export function pickAnchor(
    outgoing: Pick<Schedule, 'events' | 'offset'>,
    incoming: ReadonlyMap<string, number>,
    notBeforeSeconds: number,
): (Anchor & { noteId: string }) | null {
    const { events, offset } = outgoing;
    const minAbs = (notBeforeSeconds - offset) * 1000;

    // `events` is sorted by `abs`.
    let low = 0;
    let high = events.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (events[mid].abs < minAbs) low = mid + 1;
        else high = mid;
    }

    for (let i = low; i < events.length; i++) {
        const event = events[i];
        if (event.type !== 'meta' || event.subtype !== 'text') continue;
        const fileMs = incoming.get(event.text);
        if (fileMs === undefined) continue;
        return { noteId: event.text, fileMs, transportSeconds: event.abs / 1000 + offset };
    }
    return null;
}
