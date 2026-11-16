import { useState } from "react";
import { usePiano } from "../../performance/piano";
import { asMIDI } from "../../utils/utils";
import { onsetSeconds } from "../noteTiming";
import { rowId, type AlignedNote } from "../../fitting/alignment";
import { EVIDENCE_COLOUR } from "../evidence";
import { GRACE_COLOUR, type GraceFigure } from "./graceFigures";

interface GraceSpreadProps {
    figure: GraceFigure;
    /** The figure as the recording sounded it: `soundingNotesOf`, grace notes first. */
    notes: AlignedNote[];
    /** Selects the figure for an insert. Absent in the viewer, where a figure is only heard. */
    onClick?: () => void;
    /** The figure the bar's Insert would write. */
    selected?: boolean;
    /** One of the selected calls was fitted to this figure — see `../evidence.ts`. */
    evidence?: boolean;
    stretch: number
    height: number
}

/**
 * One grace figure as it was played: a frame from its first grace note to the strike of its
 * principal, and a line per note.
 *
 * What `ChordSpread` is to a rolled chord, in the colour the desks keep for grace figures. Drawn
 * under the chords, since a figure reaches back over the beat before its principal and the chords
 * there have to stay within reach of the pointer.
 */
export const GraceSpread = ({ figure, notes, onClick, selected = false, evidence = false, stretch, height }: GraceSpreadProps) => {
    const { play, stop } = usePiano();
    const [hovered, setHovered] = useState(false);

    const first = notes[0];
    const last = notes[notes.length - 1];
    if (first === undefined || last === undefined) return null;

    const firstOnset = onsetSeconds(first);
    const frameLength = onsetSeconds(last) - firstOnset;
    const outline = evidence ? EVIDENCE_COLOUR : selected ? GRACE_COLOUR : undefined;

    return (
        <g
            className='graceFigure'
            data-group={figure.group}
            data-selected={selected || undefined}
            data-evidence={evidence || undefined}
        >
            <rect
                onMouseOver={() => {
                    const midi = asMIDI(notes);
                    if (midi) {
                        stop();
                        play(midi);
                    }
                    setHovered(true);
                }}
                onMouseOut={() => {
                    stop();
                    setHovered(false);
                }}
                onClick={onClick}
                x={firstOnset * stretch}
                y={0}
                width={frameLength * stretch}
                height={height}
                fill={GRACE_COLOUR}
                fillOpacity={hovered || selected ? 0.5 : 0.3}
                stroke={outline}
                strokeWidth={outline ? 2 : undefined} />

            {notes.map(note => (
                <line
                    key={`graceNote_${rowId(note)}`}
                    x1={onsetSeconds(note) * stretch}
                    x2={onsetSeconds(note) * stretch}
                    y1={0}
                    y2={height}
                    stroke={evidence ? EVIDENCE_COLOUR : GRACE_COLOUR}
                    strokeWidth={1.2}
                    pointerEvents='none' />
            ))}

            {hovered && (
                <text
                    x={(firstOnset + frameLength / 2) * stretch}
                    y={height / 2}
                    textAnchor="middle"
                    fill='black'
                    fontSize={14}
                    fontWeight='bold'
                    pointerEvents='none'
                >
                    {(frameLength * 1000).toFixed(0)}ms
                </text>
            )}
        </g>
    );
};
