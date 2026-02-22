import { useState } from "react"
import { MsmNote } from "mpmify"
import { Articulation, ArticulationDef } from "../../../../mpm-ts/lib"
import { convexHull } from "../../utils/convexHull"

interface ArticulationOverlayProps {
    instruction: Articulation
    def?: ArticulationDef
    notes: MsmNote[]
    stretchX: number
    stretchY: number
    active: boolean
    onClick: () => void
}

const max = 90
const padding = 4

export const ArticulationOverlay = ({ instruction, def, notes, stretchX, stretchY, active, onClick }: ArticulationOverlayProps) => {
    const [hovered, setHovered] = useState(false)

    const noteIds = instruction.noteid?.split(' ') || []
    const affected = notes.filter(n => noteIds.includes(`#${n["xml:id"]}`))

    if (affected.length === 0) return null

    const cornerPoints: { x: number; y: number }[] = []

    for (const note of affected) {
        const onset = note.date
        const duration = note.tickDuration || note["midi.duration"]
        const noteHeight = (note.absoluteVelocityChange || 1) + 2

        const x = onset * stretchX
        const w = Math.max(1, (onset + duration) * stretchX - x)
        const cy = (max - note["midi.pitch"]) * stretchY
        const top = cy - noteHeight / 2
        const bottom = cy + noteHeight / 2

        cornerPoints.push(
            { x: x - padding, y: top - padding },
            { x: x + w + padding, y: top - padding },
            { x: x + w + padding, y: bottom + padding },
            { x: x - padding, y: bottom + padding }
        )
    }

    const hull = convexHull(cornerPoints)
    const pointsStr = hull.map(p => `${p.x},${p.y}`).join(' ')

    const minX = Math.min(...hull.map(p => p.x))
    const maxX = Math.max(...hull.map(p => p.x))
    const minY = Math.min(...hull.map(p => p.y))
    const centerX = (minX + maxX) / 2

    const source = def ?? instruction
    const r = (n: number) => Math.round(n * 100) / 100
    const attrs: string[] = []
    if (source.relativeDuration !== undefined) attrs.push(`duration: ${r(source.relativeDuration)}`)
    if (source.relativeVelocity !== undefined) attrs.push(`velocity: ${r(source.relativeVelocity)}`)
    if (source.absoluteDuration !== undefined) attrs.push(`abs. duration: ${r(source.absoluteDuration)}`)
    if (source.absoluteDurationChange !== undefined) attrs.push(`duration change: ${r(source.absoluteDurationChange)}`)

    return (
        <g>
            <polygon
                points={pointsStr}
                fill={active ? 'darkblue' : 'lightblue'}
                fillOpacity={hovered ? 0.4 : 0.2}
                stroke="black"
                strokeWidth={0.5}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
            />
            {hovered && attrs.length > 0 && (
                <text
                    x={centerX}
                    y={minY - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill="black"
                    style={{ pointerEvents: 'none' }}
                >
                    {attrs.join(' · ')}
                </text>
            )}
        </g>
    )
}
