import { useCallback, useMemo, useState } from "react";
import { Ornament, TemporalSpread } from "../../../mpm-ts/lib";
import { MsmNote } from "mpmify/lib/msm";
import { usePiano } from "react-pianosound";
import { asMIDI, PartialBy } from "../utils/utils";
import * as Tone from "tone";

interface TemporalSpreadInstructionProps {
    ornament: Ornament;
    spread: TemporalSpread;
    notes: MsmNote[];
    tickToSeconds: (tick: number) => number;
    stretch: number;
    height: number;
    active: boolean;
    onClick: () => void;
    beatLength: number;
    refBPM?: number;
}

let clickSynth: Tone.NoiseSynth | null = null;
const getClickSynth = () => {
    if (!clickSynth) {
        clickSynth = new Tone.NoiseSynth({
            noise: { type: "white" },
            envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 },
        }).toDestination();
    }
    return clickSynth;
};

export const TemporalSpreadInstruction = ({
    ornament,
    spread,
    notes,
    tickToSeconds,
    stretch,
    height,
    active,
    onClick,
    beatLength,
    refBPM = 120,
}: TemporalSpreadInstructionProps) => {
    const [hovered, setHovered] = useState(false);
    const { play, stop } = usePiano();

    const ticksToSeconds = useCallback(
        (ticks: number) => ticks * 60 / (refBPM * beatLength),
        [refBPM, beatLength]
    );

    const sortedNotes = useMemo(() => {
        const sorted = [...notes];
        if (ornament["note.order"] === "descending pitch") {
            sorted.sort((a, b) => b["midi.pitch"] - a["midi.pitch"]);
        } else {
            sorted.sort((a, b) => a["midi.pitch"] - b["midi.pitch"]);
        }
        return sorted;
    }, [notes, ornament]);

    const handlePlay = useCallback(() => {
        const n = sortedNotes.length;
        if (n === 0) return;

        const intensity = spread.intensity ?? 1;
        const frameStart = spread["frame.start"];
        const frameLength = spread.frameLength;

        const reconstructed: PartialBy<MsmNote, 'midi.onset' | 'midi.duration'>[] = sortedNotes.map((note, i) => {
            const t = n === 1 ? 0 : Math.pow(i / (n - 1), intensity);
            const offsetTicks = frameStart + t * frameLength;
            const onsetSeconds = ticksToSeconds(offsetTicks);
            return {
                ...note,
                "midi.onset": onsetSeconds,
                "midi.duration": 0.3,
            };
        });

        const midi = asMIDI(reconstructed);
        if (midi) {
            stop();
            play(midi);
        }

        const beatOffsetSeconds = ticksToSeconds(-frameStart);
        const now = Tone.now();
        getClickSynth().triggerAttackRelease("32n", now + beatOffsetSeconds);
    }, [sortedNotes, spread, ticksToSeconds, play, stop]);

    const handleStop = useCallback(() => {
        stop();
    }, [stop]);

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
                onMouseEnter={() => {
                    setHovered(true);
                    handlePlay();
                }}
                onMouseLeave={() => {
                    setHovered(false);
                    handleStop();
                }}
                onClick={onClick}
                style={{ cursor: "pointer" }}
            />
        </g>
    );
};
