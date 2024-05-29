import { useEffect, useState } from "react";
import { Point, TempoWithSegmentData, computeMillisecondsForTransition } from "../experiments/BezierApproach"

interface TimeSegmentProps {
    instruction: TempoWithSegmentData
    toSVG: (point: Point) => Point
    deactivate: (point: Point) => void
}

export const TimeSegment = ({ deactivate, instruction, toSVG }: TimeSegmentProps) => {
    const [syntheticPoints, setSyntheticPoints] = useState<Point[]>([])

    const points = instruction.segment.points

    // const p1 = toSVG(points[0])
    // const p2 = toSVG(points[points.length - 1])

    useEffect(() => {
        const physicalStartTime = instruction.segment.points[0][1]
        const newPoints: Point[] = []
        for (let i = instruction.date; i < instruction.endDate; i += 5) {
            newPoints.push([i,physicalStartTime + computeMillisecondsForTransition(i, instruction)])
        }
        setSyntheticPoints(newPoints)
    }, [instruction])

    return (
        <g className='timeSegment' data-tstamp={points[0][0]} data-direction={instruction.segment.direction}>
            {points.map((p, j) => {
                const svgPoint = toSVG(p)
                return (
                    <circle
                        key={`point_${j}`}
                        cx={svgPoint[0]}
                        cy={svgPoint[1]} r={2}
                        fill='black'
                        onClick={() => deactivate(p)}  />
                )
            })}

            {syntheticPoints.map((p, j) => {
                const svgPoint = toSVG(p)
                return (
                    <circle
                        key={`point_${j}`}
                        cx={svgPoint[0]}
                        cy={svgPoint[1]} r={1}
                        fill='red'
                        fillOpacity={0.1}/>
                )
            })}
        </g>
    )
}
