import { useState } from "react";
import { usePiano } from "react-pianosound";
import { asMIDI } from "../../utils/utils";
import { ArpeggioPlacement, MsmNote } from "mpmify";
import { TemporalSpread } from "../../../../mpm-ts/lib";

interface ChordSpreadProps {
    notes: MsmNote[];
    spread?: TemporalSpread;
    placement?: ArpeggioPlacement;
    onClick: () => void;
    stretch: number
    height: number
}

export const ChordSpread = ({ notes, onClick, spread, placement, stretch, height }: ChordSpreadProps) => {
    const { play, stop } = usePiano();
    const [hovered, setHovered] = useState(false);

    let firstOnset = notes[0]['midi.onset'];
    const lastOnset = notes[notes.length - 1]['midi.onset'];
    let frameLength = lastOnset - firstOnset;

    if (spread && spread["time.unit"] === 'milliseconds') {
        firstOnset = (firstOnset - spread["frame.start"]) / 1000;
        frameLength = spread.frameLength / 1000;
    }

    let placedLine = 0
    if (!spread) {
        if (placement === 'estimate') {
            placedLine = notes.reduce((acc, note) => acc + note['midi.onset'], 0) / notes.length;
        } else if (placement === 'before-beat') {
            placedLine = notes[notes.length - 1]['midi.onset'];
        } else if (placement === 'on-beat') {
            placedLine = notes[0]['midi.onset'];
        }
    }

    return (
        <g className='chord'>
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
                fillOpacity={hovered ? 0.5 : 0.3} />

            {notes.map(note => {
                return (
                    <line
                        key={`instantNote_${note['xml:id']}`}
                        x1={note["midi.onset"] * stretch}
                        x2={note["midi.onset"] * stretch}
                        y1={0}
                        y2={height}
                        stroke='gray'
                        strokeWidth={notes.length === 1 ? 0.4 : 0.7} />
                );
            })}

            <line
                key={`currentPlacement_${notes[0].accidentals}`}
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
