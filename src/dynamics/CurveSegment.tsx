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
    const [hovered, setHovered] = useState(false)

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

    const baselineY = 127 * stretchY
    let path = ""

    if (points.length > 0) {
        path = `M ${points[0].date * stretchX} ${baselineY} `
        path += `L ${points[0].date * stretchX} ${(127 - points[0].volume) * stretchY} `
        for (let i = 1; i < points.length; i++) {
            path += `L ${points[i].date * stretchX} ${(127 - points[i].volume) * stretchY} `
        }
        path += `L ${points[points.length - 1].date * stretchX} ${baselineY} Z`
    }

    return (
        <g
            className='curveSegment'
            data-id={`curve_${instruction["xml:id"]}`}
            data-startDate={instruction.date}
            data-endDate={instruction.endDate}
        >
            <path
                d={path}
                fill="lightblue"
                fillOpacity={hovered ? 0.6 : 0.3}
                stroke="black"
                strokeWidth={1}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            />
        </g>
    )
}
