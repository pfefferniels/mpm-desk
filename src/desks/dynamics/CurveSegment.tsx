import { computeInnerControlPointsXPositions, volumeAtDate } from "../../fitting/transformers/dynamics/Approximation"
import { DynamicsWithEndDate } from "../../fitting/transformers/dynamics/InsertDynamicsInstructions"
import { useMemo, useState } from "react"

interface CurveSegmentProps {
    active: boolean
    instruction: DynamicsWithEndDate
    stretchX: number
    stretchY: number
    onClick: () => void
}

interface DynamicsPoint {
    date: number
    volume: number
}

const stepSize = 1

export const CurveSegment = ({ instruction, stretchX, stretchY, active, onClick }: CurveSegmentProps) => {
    const [hovered, setHovered] = useState(false)

    const points = useMemo(() => {
        const newPoints: DynamicsPoint[] = []
        const instructionWithControlPoints = {
            ...instruction,
            // `<dynamics>` defaults both to 0.0 — what `resolveDynamics` fills in and what
            // `computeError` scores against. A literal 0.5 here drew a bend the renderer never
            // sounded, and `||` did it to an explicit `curvature="0"` as well. See issue #15.
            ...computeInnerControlPointsXPositions(instruction.curvature ?? 0.0, instruction.protraction ?? 0.0)
        }

        for (let date = instruction.date; date < instruction.endDate; date += stepSize) {
            newPoints.push({
                date,
                volume: volumeAtDate(instructionWithControlPoints, date)
            })
        }

        return newPoints
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
            data-id={`curve_${instruction.id}`}
            data-startDate={instruction.date}
            data-endDate={instruction.endDate}
            onClick={onClick}
        >
            <path
                d={path}
                fill={active ? 'darkblue' : 'lightblue'}
                fillOpacity={hovered ? 0.6 : 0.3}
                stroke="black"
                strokeWidth={1}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            />
        </g>
    )
}
