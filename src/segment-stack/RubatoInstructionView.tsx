import type { Rubato } from "../utils/mpm";
import { rubatoCharacter, rubatoComb } from "./instructionShapes";
import { Caption } from "./Caption";

const CHART_WIDTH = 240;
const CHART_HEIGHT = 78;
/** Where the rails start, after their labels. */
const RAIL_FROM = 50;
const RAIL_TO = CHART_WIDTH - 8;
const WRITTEN_Y = 26;
const PLAYED_Y = 54;
const TOOTH = 6;
/** A share is labelled only where it has room for its figure. */
const MIN_LABELLED = 24;
const MUTED = "#9ca3af";

interface RubatoInstructionViewProps {
    rubato: Rubato;
    /** The onsets of the score, so the frame shows the notes it moves. */
    onsets: readonly number[];
    color: string;
}

/**
 * One frame of a `<rubato>` as a comb: its notes as written above, as the rubato plays them
 * below, each joined to itself, and the share of the frame every note is given. The frame's
 * ends stay put — a rubato only redistributes the time inside it — so the lean of the teeth is
 * the whole of what it does.
 */
export const RubatoInstructionView = ({ rubato, onsets, color }: RubatoInstructionViewProps) => {
    const teeth = rubatoComb(rubato, onsets);
    const x = (fraction: number) => RAIL_FROM + fraction * (RAIL_TO - RAIL_FROM);

    /** Each onset's share of the frame: to the next onset, the last one to the frame's end. */
    const shares = (positions: number[]) =>
        positions.map((at, i) => ({ at, length: (positions[i + 1] ?? 1) - at }));
    const written = shares(teeth.map((t) => t.written));
    const played = shares(teeth.map((t) => t.played));

    const label = (share: { at: number; length: number }, y: number, fill: string, key: string) =>
        x(share.at + share.length) - x(share.at) >= MIN_LABELLED && (
            <text key={key} x={x(share.at + share.length / 2)} y={y} textAnchor="middle" fontSize={9.5} fill={fill}>
                {Math.round(share.length * 100)} %
            </text>
        );

    return (
        <>
            <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: "block" }} role="img" aria-label="The rubato's frame, as written and as played">
                <text x={RAIL_FROM - 8} y={WRITTEN_Y + 3.5} textAnchor="end" fontSize={10} fill={MUTED}>written</text>
                <text x={RAIL_FROM - 8} y={PLAYED_Y + 3.5} textAnchor="end" fontSize={10} fill={color}>played</text>

                {[WRITTEN_Y, PLAYED_Y].map((y) => (
                    <g key={y} stroke={MUTED} strokeWidth={1}>
                        <line x1={x(0)} x2={x(1)} y1={y} y2={y} />
                        <line x1={x(1)} x2={x(1)} y1={y - TOOTH} y2={y + TOOTH} />
                    </g>
                ))}

                {teeth.map((tooth, i) => (
                    <g key={i} stroke={color} strokeLinecap="round">
                        <line x1={x(tooth.written)} x2={x(tooth.played)} y1={WRITTEN_Y + TOOTH} y2={PLAYED_Y - TOOTH} strokeWidth={1.2} strokeOpacity={0.45} />
                        <line x1={x(tooth.written)} x2={x(tooth.written)} y1={WRITTEN_Y - TOOTH} y2={WRITTEN_Y + TOOTH} stroke={MUTED} strokeWidth={2} />
                        <line x1={x(tooth.played)} x2={x(tooth.played)} y1={PLAYED_Y - TOOTH} y2={PLAYED_Y + TOOTH} strokeWidth={2.4} />
                    </g>
                ))}

                {written.map((share, i) => label(share, WRITTEN_Y - TOOTH - 4, MUTED, `w${String(i)}`))}
                {played.map((share, i) => label(share, PLAYED_Y + TOOTH + 12, color, `p${String(i)}`))}
            </svg>
            <Caption color={color}>{rubatoCharacter(rubato)}</Caption>
        </>
    );
};
