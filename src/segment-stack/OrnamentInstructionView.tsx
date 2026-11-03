import type { Roll } from "./instructionShapes";
import { Caption } from "./Caption";

const CHART_WIDTH = 240;
const CHART_HEIGHT = 84;
const PAD_X = 14;
const TOP = 16;
const BOTTOM = CHART_HEIGHT - 10;
const MUTED = "#9ca3af";

interface OrnamentInstructionViewProps {
    roll: Roll;
    /** How long a tick lasts where the chord is struck, to give a roll in ticks its time. */
    msPerTick: number | null;
    color: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A rolled chord as a small piano roll: every note where it is struck against the beat, low
 * notes low, joined in the order they are played, and a note made softer by the ornament drawn
 * smaller.
 */
export const OrnamentInstructionView = ({ roll, msPerTick, color }: OrnamentInstructionViewProps) => {
    const { notes } = roll;
    const offsets = notes.map((n) => n.offset);
    const from = Math.min(0, ...offsets);
    const to = Math.max(0, ...offsets);
    const margin = Math.max((to - from) * 0.18, 1);
    const x = (offset: number) => PAD_X + ((offset - from + margin) / (to - from + 2 * margin)) * (CHART_WIDTH - 2 * PAD_X);

    const pitches = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => b - a);
    const y = (pitch: number) =>
        pitches.length === 1 ? (TOP + BOTTOM) / 2 : TOP + (pitches.indexOf(pitch) / (pitches.length - 1)) * (BOTTOM - TOP);
    const radius = (velocity: number) => clamp(4 + velocity * 0.22, 1.8, 6);

    const ascending = notes.every((n, i) => i === 0 || n.pitch >= notes[i - 1].pitch);
    const descending = notes.every((n, i) => i === 0 || n.pitch <= notes[i - 1].pitch);
    const direction = notes.length < 2 ? null : ascending ? "upwards" : descending ? "downwards" : "in the order stated";
    const placement = to <= 0 && from < 0 ? "before the beat" : from >= 0 ? "from the beat" : "across the beat";
    const span = to - from;
    const ms = roll.unit === "ms" ? span : msPerTick !== null ? span * msPerTick : null;
    const first = notes[0]?.velocity ?? 0;
    const last = notes.at(-1)?.velocity ?? 0;
    const signed = (v: number) => {
        const n = Math.round(v);
        return n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : "0";
    };
    const gradient = notes.some((n) => Math.abs(n.velocity) >= 0.5) ? `velocity ${signed(first)} → ${signed(last)}` : null;
    const words = [direction, placement, ms !== null ? `${String(Math.round(ms))} ms` : `${String(Math.round(span))} ticks`, gradient]
        .filter(Boolean)
        .join(" · ");

    return (
        <>
            <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: "block" }} role="img" aria-label="The chord as the ornament rolls it">
                <line x1={x(0)} x2={x(0)} y1={TOP - 8} y2={BOTTOM + 6} stroke={MUTED} strokeDasharray="3 3" />
                <text x={x(0) + 4} y={TOP - 6} fontSize={9.5} fill={MUTED}>beat</text>

                {notes.map((note) => (
                    <line
                        key={`tail-${note.id}`}
                        x1={x(note.offset)}
                        x2={CHART_WIDTH - 4}
                        y1={y(note.pitch)}
                        y2={y(note.pitch)}
                        stroke={color}
                        strokeOpacity={0.18}
                        strokeWidth={radius(note.velocity) * 1.4}
                        strokeLinecap="round"
                    />
                ))}
                {notes.length > 1 && (
                    <polyline
                        points={notes.map((n) => `${x(n.offset).toFixed(1)},${y(n.pitch).toFixed(1)}`).join(" ")}
                        fill="none"
                        stroke={color}
                        strokeOpacity={0.55}
                        strokeWidth={1.2}
                    />
                )}
                {notes.map((note) => (
                    <circle key={note.id} cx={x(note.offset)} cy={y(note.pitch)} r={radius(note.velocity)} fill={color} />
                ))}
            </svg>
            <Caption color={color}>{words}</Caption>
        </>
    );
};
