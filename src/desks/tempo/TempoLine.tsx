import { MouseEventHandler, useState } from "react"
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

/**
 * How wide a written curve is to the pointer: six pixels either side of a line drawn two wide.
 *
 * The line alone was the target for hovering a curve and for clicking it to select its call, and
 * two pixels is a target that takes aiming for. Not wider: a curve runs along the tops of the boxes
 * under it, and every pixel of band is a pixel of box that no longer answers a click.
 */
const HIT_WIDTH = 12

/**
 * The flash a curve gives when its call is selected, as one rule for every curve.
 *
 * Keyframes are global to the document whatever element states them, so each curve rendering its
 * own `<style>` wrote the same rule once per curve, sixty times over on the reconstruction. The
 * skyline renders this once, beside the curves.
 */
export const TempoLineKeyframes = () => (
    <style>{`
        @keyframes tempo-highlight-fade {
            from { opacity: 0.2; }
            to { opacity: 0; }
        }
    `}</style>
)

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

    // The flash is a remount: a new `key` on the rect restarts the CSS animation, and only the
    // edge into active is worth restarting it for. Compared during render rather than from an
    // effect, which would cost a second render pass per activation for a comparison that never
    // needed the DOM.
    const [wasActive, setWasActive] = useState(false)
    if (wasActive !== !!active) {
        setWasActive(!!active)
        if (active) setFlashKey(k => k + 1)
    }

    const step = 20
    const curvePoints: { time: number, bpm: number }[] = []
    for (let i = tempo.date; i <= tempo.endDate; i += step) {
        curvePoints.push({
            time: startTime + computeMillisecondsAt(i, tempo) / 1000,
            bpm: getTempoAt(i, tempo)
        })
    }

    if (curvePoints.length === 0) return null

    const points = curvePoints.map(p => `${p.time * stretchX},${p.bpm * -stretchY}`).join(' ')

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
                points={points}
                fill="none"
                strokeWidth={hovered ? 3 : 2}
                stroke={color}
                strokeOpacity={hovered ? 1 : 0.7}
            />

            {/* What the pointer meets: the same line, wide and unpainted. `transparent` rather than
                `none`, because an unpainted stroke takes no pointer events, and no
                `pointerEvents` of its own, because the skyline turns the curves' off under Draw by
                setting it on their group, and a child that stated one would not inherit that. */}
            <polyline
                className="tempoLineHit"
                points={points}
                fill="none"
                strokeWidth={HIT_WIDTH}
                stroke="transparent"
            />
        </g>
    )
}
