import { computeMillisecondsAt, getTempoAt, TempoWithEndDate } from "mpmify"
import { TempoPoint } from "./TempoDesk"
import { MouseEventHandler, useEffect, useRef, useState } from "react"

interface SyntheticLineProps {
    tempo: TempoWithEndDate
    startTime: number
    stretchX: number
    stretchY: number
    chartHeight: number
    onClick: MouseEventHandler
    active: boolean
    onPlay: () => void
    onStop: () => void
}

export const SyntheticLine = ({ tempo, startTime, stretchX, stretchY, chartHeight, onClick, active, onPlay, onStop }: SyntheticLineProps) => {
    const [hovered, setHovered] = useState(false)
    const [flashKey, setFlashKey] = useState(0)
    const prevActive = useRef(false)

    useEffect(() => {
        if (active && !prevActive.current) {
            setFlashKey(k => k + 1)
        }
        prevActive.current = active
    }, [active])

    const step = 20
    const curvePoints: TempoPoint[] = []
    for (let i = tempo.date; i <= tempo.endDate; i += step) {
        curvePoints.push({
            date: i,
            time: startTime + (computeMillisecondsAt(i, tempo)) / 1000,
            bpm: getTempoAt(i, tempo)
        })
    }

    if (curvePoints.length === 0) return null

    const meanTempoDate = (tempo.endDate - tempo.date) * (tempo.meanTempoAt || 0.5)
    const meanTempoMs = startTime + computeMillisecondsAt(tempo.date + meanTempoDate, tempo) / 1000
    const meanTempo = (tempo["transition.to"] || tempo.bpm) + 0.5 * (tempo.bpm - (tempo["transition.to"] || tempo.bpm))

    const color = 'hsl(220, 60%, 40%)'

    return (
        <g
            className='syntheticLine'
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onClick}
            onMouseEnter={onPlay}
            onMouseLeave={onStop}
        >
            {hovered && (
                <>
                    <text x={curvePoints[0].time * stretchX} y={-stretchY * curvePoints[0].bpm - 10} fontSize={12}>
                        {tempo.bpm.toFixed(2)}
                    </text>
                    <text x={curvePoints[curvePoints.length - 1].time * stretchX} y={-stretchY * curvePoints[curvePoints.length - 1].bpm - 10} fontSize={12}>
                        {tempo["transition.to"]?.toFixed(2)}
                    </text>

                    <circle
                        cx={meanTempoMs * stretchX}
                        cy={meanTempo * -stretchY}
                        r={5}
                        fill="lightcoral"
                    />

                    {tempo.meanTempoAt && (
                        <text
                            x={meanTempoMs * stretchX}
                            y={meanTempo * -stretchY - 10}
                            fontSize={12}
                        >
                            {tempo.meanTempoAt.toFixed(2)}
                        </text>
                    )}
                </>
            )}

            {flashKey > 0 && (
                <rect
                    key={`flash_${flashKey}`}
                    x={curvePoints[0].time * stretchX}
                    y={chartHeight}
                    width={(curvePoints[curvePoints.length - 1].time - curvePoints[0].time) * stretchX}
                    height={-chartHeight}
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
