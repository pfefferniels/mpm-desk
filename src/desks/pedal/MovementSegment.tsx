import { SVGProps, useMemo, useState } from "react"
import { computeInnerControlPointsXPositions, positionAtDate } from "../../fitting/transformers/dynamics/Approximation"
import type { Instruction } from "../../fitting/instructions/index"
import type { Normalized } from "espressivo"

interface MovementSegmentProps extends SVGProps<SVGPathElement> {
    instruction: Instruction<'movement'> & { endDate: number }
    stretchX: number
    stretchY: number
}

interface MovementPoint {
    date: number
    position: number
}

/** The sampling step, in ticks — one point per tick of the movement's span. */
const stepSize = 1

export const MovementSegment = ({ instruction, stretchX, stretchY, ...rest }: MovementSegmentProps) => {
    const [hovered, setHovered] = useState(false)

    // The sampled curve is a function of the instruction and nothing else — zoom is applied
    // below, in the path — so it is derived here rather than pushed into state from an effect.
    const points = useMemo(() => {
        const sampled: MovementPoint[] = []
        const instructionWithControlPoints = {
            ...instruction,
            // `@position` is optional on a `<movement>` — MPM lets one carry on from where the
            // previous ended — but `positionAtDate` needs somewhere to ramp from. Every movement
            // this desk draws was written by `InsertPedal`, which always states it; one without
            // is drawn from a released pedal rather than not drawn at all.
            position: (instruction.position ?? 0) as Normalized,
            // `<movement>` defaults curvature to 0.4 and protraction to 0.0 — deliberately not
            // dynamics' 0.0, so the two call sites cannot share a literal. `??`, not `||`: an
            // explicit `curvature="0"` is a pedal fitted to no bend, not an absent attribute.
            ...computeInnerControlPointsXPositions(instruction.curvature ?? 0.4, instruction.protraction ?? 0.0)
        }

        for (let date = instruction.date; date < instruction.endDate; date += stepSize) {
            sampled.push({
                date,
                position: positionAtDate(instructionWithControlPoints, date)
            })
        }

        return sampled
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
            data-id={`movementSegment_${instruction.id}`}
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