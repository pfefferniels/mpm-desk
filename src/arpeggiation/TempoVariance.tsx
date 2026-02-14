import { MSM } from "mpmify";
import { usePhysicalZoom } from "../hooks/ZoomProvider";
import { Scope } from "../TransformerViewProps";
import { useState } from "react";

export const TempoVariance = ({ msm, part, beatLength }: { msm: MSM; part: Scope; beatLength: number }) => {
    const [hover, setHover] = useState<number | null>(null);
    const stretchX = usePhysicalZoom();
    const height = 250;

    type Range = { min: number; max: number };
    type BPM = { date: number; onset: number; bpm: Range };

    const calcBpm = (onset: number, prevOnset: number, dateDiff: number) =>
        (60 / (onset - prevOnset)) * (dateDiff / beatLength);

    const bpms: BPM[] = [];
    let prevOnset: Range | undefined;
    let prevDate: number | undefined;

    for (let date = 0; date < msm.lastDate(); date += beatLength) {
        const currentNotes = msm.notesAtDate(date, part);
        if (!currentNotes.length) continue;

        const minOnset = Math.min(...currentNotes.map(n => n["midi.onset"]));
        const avgOnset = currentNotes.reduce((sum, n) => sum + n["midi.onset"], 0) / currentNotes.length;
        const maxOnset = Math.max(...currentNotes.map(n => n["midi.onset"]));
        const onset: Range = { min: minOnset, max: maxOnset };

        if (prevOnset !== undefined && prevDate !== undefined) {
            const dateDiff = date - prevDate;
            const bpm: Range = {
                max: calcBpm(onset.max, prevOnset.min, dateDiff),
                min: calcBpm(onset.min, prevOnset.max, dateDiff),
            };
            bpms.push({ date, onset: avgOnset, bpm });
        }

        prevOnset = onset;
        prevDate = date;
    }

    return (
        <g>
            {[20, 40, 60, 80, 100].map(bpm => {
                const y = height - bpm;
                return (
                    <line
                        key={`gridline_${bpm}`}
                        x1={0}
                        x2={msm.lastDate() * stretchX}
                        y1={y}
                        y2={y}
                        stroke="black"
                        strokeWidth={0.2}
                    />
                );
            })}
            {bpms.map(({ date, onset, bpm }, i, arr) => {
                const next = arr[i + 1];
                if (!next) return null;

                const points = [
                    [onset * stretchX, height - bpm.min],
                    [onset * stretchX, height - bpm.max],
                    [next.onset * stretchX, height - next.bpm.max],
                    [next.onset * stretchX, height - next.bpm.min],
                ]
                    .map(([x, y]) => `${x},${y}`)
                    .join(" ");

                return (
                    <g
                        key={date}
                        onMouseOver={() => setHover(date)}
                        onMouseOut={() => setHover(null)}
                    >
                        <polygon points={points} fill="blue" strokeWidth={0.2} stroke='black' fillOpacity={hover === date ? 0.8 : 0.3} />
                        {hover === date && (
                            <>
                                <text
                                    x={onset * stretchX}
                                    y={height - bpm.min}
                                    fill="black"
                                    fontSize={12}
                                    fillOpacity={0.8}
                                    fontWeight='bold'
                                >
                                    {bpm.min.toFixed(0)}–{bpm.max.toFixed(0)}
                                </text>
                                <text
                                    x={next.onset * stretchX}
                                    y={height - next.bpm.max}
                                    fill="black"
                                    fontSize={12}
                                    fillOpacity={0.8}
                                    fontWeight='bold'
                                >
                                    {next.bpm.min.toFixed(0)}–{next.bpm.max.toFixed(0)}
                                </text>
                            </>
                        )}
                    </g>
                );
            })}
        </g>
    );
};
