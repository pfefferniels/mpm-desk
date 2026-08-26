import { useState } from "react"
import type { AlignedNote } from "../../fitting/alignment"
import type { Instruction } from "../../fitting/instructions/index"
import type { ArticulationModifiers } from "../../fitting/transformers/articulation/index"
import type { Residual } from "../../fitting/residual"
import type { ArticulationDef } from "espressivo"
import { convexHull } from "../../utils/convexHull"

interface ArticulationOverlayProps {
    instruction: Instruction<'articulation'>
    def?: ArticulationDef
    notes: AlignedNote[]
    /** Where each note's recorded span sits on the tick grid — the same figures the notes are drawn from. */
    residual: Residual
    stretchX: number
    stretchY: number
    active: boolean
    onClick: () => void
}

const max = 90
const padding = 4

/**
 * The four modifiers the label shows, as the *document* states them.
 *
 * espressivo's `ArticulationDef` getters answer what the renderer will do, so an unstated
 * `@relativeDuration` comes back as its neutral 1.0 — which would put "duration: 1" on every
 * overlay naming a def, including ones that state nothing of the kind. The label shows the
 * attributes actually written, so they are read off the element.
 */
const statedBy = (def: ArticulationDef): ArticulationModifiers => {
    const xml = def.getXml()
    const read = (name: string) => {
        const value = xml.getAttributeValue(name)
        return value === null ? undefined : parseFloat(value)
    }

    return {
        relativeDuration: read('relativeDuration'),
        relativeVelocity: read('relativeVelocity'),
        absoluteDuration: read('absoluteDuration'),
        absoluteDurationChange: read('absoluteDurationChange'),
    }
}

export const ArticulationOverlay = ({ instruction, def, notes, residual, stretchX, stretchY, active, onClick }: ArticulationOverlayProps) => {
    const [hovered, setHovered] = useState(false)

    const noteIds = instruction.noteid?.split(' ') || []
    const affected = notes.filter(n => noteIds.includes(`#${n["xml:id"]}`))

    if (affected.length === 0) return null

    const cornerPoints: { x: number; y: number }[] = []

    for (const note of affected) {
        const placed = residual.of(note)
        const onset = note.date
        // The same two decisions the note itself is drawn from, so the hull wraps what is on
        // screen: an unplaceable note has a zero-length recorded span, and the bar thickness
        // collapses an undefined velocity residual to the same minimum a zero one gets.
        const duration = placed?.tickDuration ?? 0
        const noteHeight = (placed?.velocity || 1) + 2

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

    const source = def ? statedBy(def) : instruction
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
