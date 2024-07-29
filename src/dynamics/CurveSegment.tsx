import { computeInnerControlPointsXPositions, DynamicsWithEndDate, volumeAtDate } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"

interface CurveSegmentProps {
    instruction: DynamicsWithEndDate
    stretchX: number
    stretchY: number
}

interface DynamicsPoint {
    date: number
    volume: number
}

export const CurveSegment = ({ instruction, stretchX, stretchY }: CurveSegmentProps) => {
    const [points, setPoints] = useState<DynamicsPoint[]>([])

    const stepSize = 1

    useEffect(() => {
        const newPoints = []
        const instructionWithControlPoints = {
            ...instruction,
            ...computeInnerControlPointsXPositions(instruction.curvature || 0.5, instruction.protraction || 0)
        }

        for (let date = instruction.date; date < instruction.endDate; date += stepSize) {
            newPoints.push({
                date,
                volume: volumeAtDate(instructionWithControlPoints, date)
            })
        }

        setPoints(newPoints)
    }, [instruction])

    return (
        <g
            className='curveSegment'
            data-id={`curve_${instruction["xml:id"]}`}
            data-startDate={instruction.date}
            data-endDate={instruction.endDate}
        >
            {points.map((p, i) => {
                return (
                    <circle
                        key={`point_${i}_${instruction["xml:id"]}`}
                        cx={p.date * stretchX + 10}
                        cy={(127 - p.volume) * stretchY}
                        r={2} />
                )
            })
            }
        </g>
    )
}
