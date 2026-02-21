import { SVGProps, useEffect, useState } from "react"
import { Movement } from "../../../../mpm-ts/lib"
import { computeInnerControlPointsXPositions, positionAtDate } from "mpmify"

interface MovementSegmentProps extends SVGProps<SVGPathElement> {
    instruction: Movement & { endDate: number }
    stretchX: number
    stretchY: number
}

interface MovementPoint {
    date: number
    position: number
}


export const MovementSegment = ({ instruction, stretchX, stretchY, ...rest }: MovementSegmentProps) => {
    const [points, setPoints] = useState<MovementPoint[]>([])
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
                position: positionAtDate(instructionWithControlPoints, date)
            })
        }

        setPoints(newPoints)
    }, [instruction])

    let path = ""

    if (points.length > 0) {
        path = `M ${points[0].date * stretchX} ${0} `
        path += `L ${points[0].date * stretchX} ${(points[0].position) * stretchY} `
        for (let i = 1; i < points.length; i++) {
            path += `L ${points[i].date * stretchX} ${(points[i].position) * stretchY} `
        }
        path += `L ${points[points.length - 1].date * stretchX} ${0}`
    }

    return (
        <g
            className='movementSegment'
            data-id={`movementSegment_${instruction["xml:id"]}`}
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
                {...rest}
            />
        </g>
    )
}