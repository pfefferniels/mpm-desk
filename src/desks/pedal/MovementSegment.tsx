import { SVGProps, useMemo, useState } from "react"
import { computeInnerControlPointsXPositions, positionAtDate } from "../../fitting/transformers/dynamics/Approximation"
import type { Instruction } from "../../fitting/instructions/index"
import type { Normalized } from "espressivo"
import { areaPath, sampleTransition } from "../transitionSamples"

interface MovementSegmentProps extends SVGProps<SVGPathElement> {
    instruction: Instruction<'movement'> & { endDate: number }
    stretchX: number
    stretchY: number
}

export const MovementSegment = ({ instruction, stretchX, stretchY, ...rest }: MovementSegmentProps) => {
    const [hovered, setHovered] = useState(false)

    // The attributes the curve is made of, and not the instruction: the desk reads the map afresh
    // on every render, so keying the path on the object would rebuild it every time.
    const { date, endDate, position, transitionTo, curvature, protraction } = instruction

    const path = useMemo(() => {
        const span = {
            date,
            endDate,
            transitionTo,
            // `@position` is optional on a `<movement>` — MPM lets one carry on from where the
            // previous ended — but `positionAtDate` needs somewhere to ramp from. Every movement
            // this desk draws was written by `InsertPedal`, which always states it; one without
            // is drawn from a released pedal rather than not drawn at all.
            position: (position ?? 0) as Normalized,
            // `<movement>` defaults curvature to 0.4 and protraction to 0.0 — deliberately not
            // dynamics' 0.0, so the two call sites cannot share a literal. `??`, not `||`: an
            // explicit `curvature="0"` is a pedal fitted to no bend, not an absent attribute.
            ...computeInnerControlPointsXPositions(curvature ?? 0.4, protraction ?? 0.0)
        }

        const samples = sampleTransition(span, at => positionAtDate(span, at), stretchX)

        return areaPath(samples.map(({ x, value }) => ({ x, y: value * stretchY })), 0)
    }, [date, endDate, position, transitionTo, curvature, protraction, stretchX, stretchY])

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