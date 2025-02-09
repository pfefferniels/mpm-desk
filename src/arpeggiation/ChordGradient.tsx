import { MsmNote } from "mpmify/lib/msm";
import { DynamicsGradient } from "mpmify";
import { useState } from "react";
import { usePiano } from "react-pianosound";
import { asMIDI } from "../utils";

interface ChordGradientProps {
    notes: MsmNote[];
    gradient?: DynamicsGradient
    onClick: () => void;
    stretch: number
    height: number
}

export const ChordGradient = ({ notes, onClick, gradient, stretch, height }: ChordGradientProps) => {
    const { play, stop } = usePiano();
    const [hovered, setHovered] = useState(false)

    if (notes.length <= 1) return null

    const firstNote = notes[0];
    const lastNote = notes[notes.length - 1];
    const firstX = firstNote["midi.onset"] * stretch;
    const firstY = height - (firstNote["midi.velocity"] / 127) * height;
    const lastX = lastNote["midi.onset"] * stretch;
    const lastY = height - (lastNote["midi.velocity"] / 127) * height;

    let defaultGradient
    if (lastNote["midi.velocity"] > firstNote["midi.velocity"]) {
        defaultGradient = { from: -1, to: 0 }
    }
    else {
        defaultGradient = { from: 0, to: -1 }
    }

    return (
        <g
            className='chordGradient'
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
        >
            {notes.map((note, index) => {
                const x = note["midi.onset"] * stretch;
                const y = height - (note["midi.velocity"] / 127) * height;

                return (
                    <circle
                        key={index}
                        cx={x}
                        cy={y}
                        r={2.5}
                        fill="blue"
                        fillOpacity={0.5}
                        stroke='black'
                        strokeWidth={0.5}
                    />
                );
            })}

            <line x1={firstX} y1={firstY} x2={lastX} y2={lastY} stroke="black" strokeWidth={2} />;

            {hovered && (
                <>
                    <text
                        x={firstNote["midi.onset"] * stretch - 12}
                        y={height - (firstNote["midi.velocity"] / 127) * height}
                        fill="black"
                        fontSize="10"
                    >
                        {(gradient || defaultGradient).from}
                    </text>

                    <text
                        x={lastNote["midi.onset"] * stretch + 2}
                        y={height - (lastNote["midi.velocity"] / 127) * height}
                        fill="black"
                        fontSize="10"
                    >
                        {(gradient || defaultGradient).to}
                    </text>
                </>
            )}
        </g>
    )
}
