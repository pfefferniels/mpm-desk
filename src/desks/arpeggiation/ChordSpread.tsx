import { useState } from "react";
import { usePiano } from "../../performance/piano";
import { asMIDI } from "../../utils/utils";
import { onsetSeconds } from "../noteTiming";
import type { ArpeggioPlacement } from "../../fitting/transformers/ornamentation/InsertTemporalSpread";
import { rowId, type AlignedNote } from "../../fitting/alignment";
import { FrameDomain, type TemporalSpread } from "espressivo";
import { EVIDENCE_COLOUR } from "../evidence";

interface ChordSpreadProps {
    notes: AlignedNote[];
    spread?: TemporalSpread;
    placement?: ArpeggioPlacement;
    /** Selects the chord for an insert. Absent in the viewer, where a chord is only heard. */
    onClick?: () => void;
    /** One of the selected calls was fitted to this chord — see `../evidence.ts`. */
    evidence?: boolean;
    stretch: number
    height: number
}

/**
 * One chord as it was rolled: a frame from its first onset to its last, a line per note, and the
 * line a pending insert would place it on.
 *
 * Where a selected call was fitted to it, the frame is outlined and its notes drawn in the
 * evidence colour, over the red the frame always has.
 */
export const ChordSpread = ({ notes, onClick, spread, placement, evidence = false, stretch, height }: ChordSpreadProps) => {
    const { play, stop } = usePiano();
    const [hovered, setHovered] = useState(false);

    let firstOnset = onsetSeconds(notes[0]);
    const lastOnset = onsetSeconds(notes[notes.length - 1]);
    let frameLength = lastOnset - firstOnset;

    if (spread && spread.frameDomain === FrameDomain.Milliseconds) {
        firstOnset = (firstOnset - spread.frameStart) / 1000;
        frameLength = spread.getFrameLength() / 1000;
    }

    let placedLine = 0
    if (!spread) {
        if (placement === 'estimate') {
            placedLine = notes.reduce((acc, note) => acc + onsetSeconds(note), 0) / notes.length;
        } else if (placement === 'before-beat') {
            placedLine = onsetSeconds(notes[notes.length - 1]);
        } else if (placement === 'on-beat') {
            placedLine = onsetSeconds(notes[0]);
        }
    }

    return (
        <g className='chord' data-date={notes[0].date} data-evidence={evidence || undefined}>
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
                fill='red'
                fillOpacity={hovered ? 0.5 : 0.3}
                stroke={evidence ? EVIDENCE_COLOUR : undefined}
                strokeWidth={evidence ? 2 : undefined} />

            {notes.map(note => {
                return (
                    <line
                        key={`instantNote_${rowId(note)}`}
                        x1={onsetSeconds(note) * stretch}
                        x2={onsetSeconds(note) * stretch}
                        y1={0}
                        y2={height}
                        stroke={evidence ? EVIDENCE_COLOUR : 'gray'}
                        strokeWidth={evidence ? 1.2 : notes.length === 1 ? 0.4 : 0.7} />
                );
            })}

            <line
                x1={placedLine * stretch}
                x2={placedLine * stretch}
                y1={0}
                y2={height}
                stroke='red'
                strokeWidth={1} />


            {hovered && (
                <text
                    x={(firstOnset + frameLength / 2) * stretch}
                    y={height / 2}
                    textAnchor="middle"
                    fill='black'
                    opacity={hovered ? 1 : 0.2}
                    fontSize={hovered ? 14 : 10}
                    fontWeight={hovered ? 'bold' : 'normal'}
                >
                    {(frameLength * 1000).toFixed(0)}ms
                </text>
            )}
        </g>
    );
};
