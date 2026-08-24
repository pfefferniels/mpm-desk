/**
 * One colour per MPM element type.
 *
 * The timeline's rows differ in height as well as in colour now — a lane that is
 * drawn as what it does needs twice a lane that is drawn as when it happens — so
 * this is what says which is which where two rows are the same size.
 *
 * `movement` is the deliberate odd one out. The pedal is a condition rather than
 * a gesture — it is what the other instructions are heard through — so it stays
 * neutral and lets the rest of the card carry the hue.
 */
const SPAN_COLORS: Record<string, string> = {
    dynamics: "#8e44ad",
    tempo: "#16a085",
    ornament: "#d35400",
    articulation: "#2c3e50",
    rubato: "#e74c3c",
    accentuationPattern: "#2980b9",
    movement: "#475569",
};

export function getLaneColor(type: string): string {
    return SPAN_COLORS[type] ?? "#666";
}
