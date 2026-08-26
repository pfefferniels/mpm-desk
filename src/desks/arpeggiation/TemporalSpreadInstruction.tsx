import { useCallback, useMemo, useState } from "react";
import type { AlignedNote } from "../../fitting/alignment";
import type { Instruction } from "../../fitting/instructions/index";
import type { TemporalSpread } from "espressivo";
import { usePiano } from "react-pianosound";
import { asMIDI, PartialBy } from "../../utils/utils";
import { soundingAt } from "../noteTiming";
import * as Tone from "tone";

interface TemporalSpreadInstructionProps {
    ornament: Instruction<'ornament'>;
    spread: TemporalSpread;
    notes: AlignedNote[];
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

/** How long a preview note sounds. Long enough to hear the roll, short enough not to blur it. */
const PREVIEW_SOUNDING_SECONDS = 0.3;

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
        if (ornament.noteOrder === "descending pitch") {
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
        const frameStart = spread.frameStart;
        const frameLength = spread.getFrameLength();

        // The one place a desk states `milliseconds.*` rather than asking `noteTiming` for it.
        // These notes are not recorded — they are a preview, synthesized at computed offsets —
        // and `asMIDI` reads a preview exactly as it reads a recording: an absolute onset and an
        // absolute release, in milliseconds. `soundingAt` states both from seconds, which is
        // what everything here computes in — the 0.3 s sounding length included.
        const reconstructed: PartialBy<AlignedNote, 'milliseconds.date' | 'milliseconds.date.end'>[] = sortedNotes.map((note, i) => {
            const t = n === 1 ? 0 : Math.pow(i / (n - 1), intensity);
            const offsetTicks = frameStart + t * frameLength;
            const onsetSeconds = ticksToSeconds(offsetTicks);
            return { ...note, ...soundingAt(onsetSeconds, PREVIEW_SOUNDING_SECONDS) };
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

    const xStart = tickToSeconds(ornament.date + spread.frameStart) * stretch;
    const xEnd = tickToSeconds(ornament.date + spread.frameStart + spread.getFrameLength()) * stretch;
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
