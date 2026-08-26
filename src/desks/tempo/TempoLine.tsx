import { MouseEventHandler, useEffect, useRef, useState } from "react"
import { computeMillisecondsAt, getTempoAt } from "../../fitting/transformers/tempo/tempoCalculations"
import type { TempoWithEndDate } from "../../fitting/transformers/tempo/tempoCalculations"

/**
 * A `@bpm` as the hover label states it.
 *
 * `@bpm` and `@transition.to` are `number | string` — MPM lets either be a style-relative name
 * such as "Allegro", which is why espressivo types them that way. The desk only ever writes
 * numbers, so a name reaches this label only from a document somebody else wrote; it is shown
 * verbatim rather than coerced into `NaN`.
 */
const bpmLabel = (bpm: number | string | undefined): string | undefined =>
    typeof bpm === 'number' ? bpm.toFixed(2) : bpm

interface TempoLineProps {
    tempo: TempoWithEndDate
    startTime: number
    stretchX: number
    stretchY: number
    active?: boolean
    onClick?: MouseEventHandler
    onMouseEnter?: () => void
    onMouseLeave?: () => void
}

export const TempoLine = ({ tempo, startTime, stretchX, stretchY, active, onClick, onMouseEnter, onMouseLeave }: TempoLineProps) => {
    const [hovered, setHovered] = useState(false)
    const [flashKey, setFlashKey] = useState(0)
    const prevActive = useRef(false)

    useEffect(() => {
        if (active && !prevActive.current) {
            setFlashKey(k => k + 1)
        }
        prevActive.current = !!active
    }, [active])

    const step = 20
    const curvePoints: { time: number, bpm: number }[] = []
    for (let i = tempo.date; i <= tempo.endDate; i += step) {
        curvePoints.push({
            time: startTime + computeMillisecondsAt(i, tempo) / 1000,
            bpm: getTempoAt(i, tempo)
        })
    }

    if (curvePoints.length === 0) return null

    const color = 'hsl(220, 60%, 40%)'

    return (
        <g
            className='tempoLine'
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {hovered && (
                <>
                    <text x={curvePoints[0].time * stretchX} y={-stretchY * curvePoints[0].bpm - 10} fontSize={12}>
                        {bpmLabel(tempo.bpm)}
                    </text>
                    <text x={curvePoints[curvePoints.length - 1].time * stretchX} y={-stretchY * curvePoints[curvePoints.length - 1].bpm - 10} fontSize={12}>
                        {bpmLabel(tempo.transitionTo)}
                    </text>
                </>
            )}

            {flashKey > 0 && (
                <rect
                    key={`flash_${flashKey}`}
                    x={curvePoints[0].time * stretchX}
                    y={Math.min(...curvePoints.map(p => p.bpm * -stretchY)) - 10}
                    width={(curvePoints[curvePoints.length - 1].time - curvePoints[0].time) * stretchX}
                    height={Math.abs(Math.min(...curvePoints.map(p => p.bpm * -stretchY))) + 10}
                    fill="steelblue"
                    pointerEvents="none"
                    style={{
                        animation: 'tempo-highlight-fade 3.5s ease-out forwards',
                    }}
                />
            )}

            <polyline
                points={curvePoints.map(p => `${p.time * stretchX},${p.bpm * -stretchY}`).join(' ')}
                fill="none"
                strokeWidth={hovered ? 3 : 2}
                stroke={color}
                strokeOpacity={hovered ? 1 : 0.7}
            />

            <style>{`
                @keyframes tempo-highlight-fade {
                    from { opacity: 0.2; }
                    to { opacity: 0; }
                }
            `}</style>
        </g>
    )
}
