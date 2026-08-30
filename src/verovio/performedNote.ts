import { midiPitch } from "../performance/pitch";

/** What the rendered SVG says about one note of the performance */
export interface PerformedNote {
    /** The xml:id of the note in the MEI */
    id: string;
    /** Onset in milliseconds from the start of the recording */
    onsetMs?: number;
    offsetMs?: number;
    velocity?: number;
    /** True when the recording has no <when> for this note and it was interpolated */
    unaligned: boolean;
    pitch?: number;
}

/**
 * Read a note back out of the rendered score. The performed values come from the
 * data-perf-* attributes the toolkit writes, the pitch from the notated one.
 */
export function readPerformedNote(element: Element): PerformedNote | undefined {
    const id = element.getAttribute("data-id");
    if (!id) return undefined;

    const number = (name: string) => {
        const value = element.getAttribute(name);
        return value === null ? undefined : Number(value);
    };

    return {
        id,
        onsetMs: number("data-perf-onset"),
        offsetMs: number("data-perf-offset"),
        velocity: number("data-perf-velocity"),
        unaligned: element.hasAttribute("data-perf-unaligned"),
        pitch: midiPitch(
            element.getAttribute("data-pname"),
            element.getAttribute("data-oct"),
            element.getAttribute("data-accid") ?? element.getAttribute("data-accid.ges")
        ),
    };
}
