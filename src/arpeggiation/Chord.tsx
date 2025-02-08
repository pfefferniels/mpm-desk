import { MsmNote } from "mpmify/lib/msm";
import { useState } from "react";
import { usePiano } from "react-pianosound";
import { asMIDI } from "../utils";
import { ArpeggioPlacement } from "mpmify";

interface ChordProps {
    notes: MsmNote[];
    placement: ArpeggioPlacement;
    onClick: () => void;
    stretch: number
    height: number
}

export const Chord = ({ notes, onClick, placement, stretch, height }: ChordProps) => {
    const { play, stop } = usePiano();
    const [hovered, setHovered] = useState(false);

    if (notes.length <= 1) {
        return null;
    }

    const firstOnset = notes[0]['midi.onset'];
    const lastOnset = notes[notes.length - 1]['midi.onset'];
    const frameLength = lastOnset - firstOnset;

    let placedLine = 0
    if (placement === 'estimate') {
        placedLine = notes.reduce((acc, note) => acc + note['midi.onset'], 0) / notes.length;
    } else if (placement === 'before-beat') {
        placedLine = notes[notes.length - 1]['midi.onset'];
    } else if (placement === 'on-beat') {
        placedLine = notes[0]['midi.onset'];
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
                fill='gray'
                fillOpacity={hovered ? 0.35 : 0.1} />

            {notes.map(note => {
                return (
                    <line
                        key={`instantNote_${note['xml:id']}`}
                        x1={note["midi.onset"] * stretch}
                        x2={note["midi.onset"] * stretch}
                        y1={0}
                        y2={height}
                        stroke='gray'
                        strokeWidth={1} />
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


            {frameLength !== 0 && (
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
