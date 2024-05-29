import { useEffect, useState } from "react"
import { Point, TempoWithSegmentData } from "../experiments/BezierApproach"
import { getTempoAt } from "./getTempoAt"

interface TempoSegmentProps {
    instruction: TempoWithSegmentData
    toSVG: (point: Point) => Point
}

export const TempoSegment = ({ instruction, toSVG }: TempoSegmentProps) => {
    const [syntheticPoints, setSyntheticPoints] = useState<Point[]>([])

    useEffect(() => {
        console.log('tempo points=', instruction.segment.tempoPoints)
        const newPoints: Point[] = []
        console.log(instruction.beatLength)
        for (let i = instruction.date; i < instruction.endDate; i += 5) {
            newPoints.push([i, getTempoAt(i, instruction) * instruction.beatLength * 4])
        }
        setSyntheticPoints(newPoints)
    }, [instruction])

    //const firstTempo = instruction.segment.tempoPoints[0]
    //const lastTempo = instruction.segment.tempoPoints[instruction.segment.tempoPoints.length - 1]
    //
    //const p1 = toSVG([firstTempo[0], firstTempo[1] / 1000])
    //const p2 = toSVG([lastTempo[0], lastTempo[1] / 1000])

    return (
        <>
            <g className='tempoSegment' data-tstamp={instruction.segment.tempoPoints[0][0]}>
                {instruction.segment.tempoPoints.map((p, j) => {
                    if (j === instruction.segment.tempoPoints.length - 1) {
                        // TODO
                        return null
                    }
                    const [xStart, y] = toSVG([p[0], p[1] / 1000])
                    const [xEnd, ] = toSVG([instruction.segment.tempoPoints[j + 1][0], 0])
                    return (
                        <line
                            className='avgTempo'
                            key={`point_${j}`}
                            x1={xStart}
                            y1={y}
                            x2={xEnd}
                            y2={y}
                            data-bpm={p[1]}
                            stroke='black'
                            strokeDasharray={4}
                            strokeWidth={1} />
                    )
                })}
            </g>

            <g>
                {syntheticPoints.map((p, j) => {
                    const svgPoint = toSVG([p[0], 60 / p[1]])
                    return (
                        <circle key={`controlPoint_${j}`} className='controlpoint' cx={svgPoint[0]} cy={svgPoint[1]} r={0.5} data-bpm={p[1]} fill='black' fillOpacity={0.5} />
                    )
                })}
            </g>
        </>
    )
}
