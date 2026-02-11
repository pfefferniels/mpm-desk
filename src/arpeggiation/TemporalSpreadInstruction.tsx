import { useState } from "react";
import { Ornament, TemporalSpread } from "../../../mpm-ts/lib";

interface TemporalSpreadInstructionProps {
    ornament: Ornament;
    spread: TemporalSpread;
    tickToSeconds: (tick: number) => number;
    stretch: number;
    height: number;
    active: boolean;
    onClick: () => void;
}

export const TemporalSpreadInstruction = ({
    ornament,
    spread,
    tickToSeconds,
    stretch,
    height,
    active,
    onClick,
}: TemporalSpreadInstructionProps) => {
    const [hovered, setHovered] = useState(false);

    const xStart = tickToSeconds(ornament.date + spread["frame.start"]) * stretch;
    const xEnd = tickToSeconds(ornament.date + spread["frame.start"] + spread.frameLength) * stretch;
    const width = xEnd - xStart;

    if (width <= 0) return null;

    return (
        <g className="temporalSpreadInstruction">
            <rect
                x={xStart}
                y={0}
                width={width}
                height={height}
                fill={active ? "blue" : "gray"}
                fillOpacity={hovered ? 0.5 : 0.2}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                onClick={onClick}
                style={{ cursor: "pointer" }}
            />
        </g>
    );
};
