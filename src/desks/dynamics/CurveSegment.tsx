import { computeInnerControlPointsXPositions, volumeAtDate } from "../../fitting/transformers/dynamics/Approximation"
import { DynamicsWithEndDate } from "../../fitting/transformers/dynamics/InsertDynamicsInstructions"
import { useMemo, useState } from "react"
import { areaPath, sampleTransition } from "../transitionSamples"
import type { VelocityAxis } from "../velocityAxis"

interface CurveSegmentProps {
    active: boolean
    instruction: DynamicsWithEndDate
    stretchX: number
    /** The plot's, so a curve and the dots it was fitted over are drawn to the one scale. */
    axis: VelocityAxis
    onClick: () => void
}

export const CurveSegment = ({ instruction, stretchX, axis, active, onClick }: CurveSegmentProps) => {
    const [hovered, setHovered] = useState(false)

    // The attributes the curve is made of, and not the instruction: the desk reads the map afresh
    // on every render, so keying the path on the object would rebuild it every time.
    const { date, endDate, volume, transitionTo, curvature, protraction } = instruction

    const path = useMemo(() => {
        const span = {
            date,
            endDate,
            volume,
            transitionTo,
            // `<dynamics>` defaults both to 0.0 — what `resolveDynamics` fills in and what
            // `computeError` scores against. A literal 0.5 here drew a bend the renderer never
            // sounded, and `||` did it to an explicit `curvature="0"` as well. See issue #15.
            ...computeInnerControlPointsXPositions(curvature ?? 0.0, protraction ?? 0.0)
        }

        const samples = sampleTransition(span, at => volumeAtDate(span, at), stretchX)

        // Filled down to the foot of the axis rather than to velocity 0, which the plot need not
        // reach: it shows the range its velocities span, and no more.
        return areaPath(
            samples.map(({ x, value }) => ({ x, y: axis.y(value) })),
            axis.y(axis.min),
            { closed: true }
        )
    }, [date, endDate, volume, transitionTo, curvature, protraction, stretchX, axis])

    return (
        <g
            className='curveSegment'
            data-id={`curve_${instruction.id}`}
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
