/**
 * One colour per MPM element type.
 *
 * Shared, because the same gestures are drawn twice over: as lanes on the centre
 * line under an opened segment, and as rows of the timeline a hovered one shows.
 */
const SPAN_COLORS: Record<string, string> = {
    dynamics: "#8e44ad",
    tempo: "#16a085",
    ornament: "#d35400",
    articulation: "#2c3e50",
    rubato: "#e74c3c",
    accentuationPattern: "#2980b9",
    movement: "#7f8c8d",
};

export function getLaneColor(type: string): string {
    return SPAN_COLORS[type] ?? "#666";
}
