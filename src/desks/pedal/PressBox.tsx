import { useState } from 'react'
import type { AlignedPedal } from '../../fitting/alignment'
import type { TickVertex } from '../../fitting/transformers/tempo/tickTimes'
import { laneY, stepLine } from '../pedalGeometry'
import { ROW_HEIGHT } from './layout'
import { EVIDENCE_COLOUR } from '../evidence'

const PRESS = '#4b5563'
const PICKED = 'hsl(220, 60%, 50%)'

interface PressBoxProps {
    pedal: AlignedPedal
    /** The line the press recorded, on the tick grid. */
    line: readonly TickVertex[]
    /** The top of the row it is drawn on. */
    y: number
    stretchX: number
    /** A selected call was fitted to this press — see `EVIDENCE_COLOUR`. */
    evidence?: boolean
    /** What a click on the press does. Absent in the viewer, where the press is no target. */
    onPick?: (pedal: AlignedPedal) => void
}

/**
 * One recorded press, drawn as the line it recorded: at rest along the top of its row, a full
 * stroke down at the bottom, held between vertices the way a controller value is.
 *
 * A click writes the whole line as movements, so the press is one target. The line itself takes
 * no pointer events; the box it encloses does. Without `onPick` it is drawn and nothing more.
 */
export const PressBox = ({ pedal, line, y, stretchX, evidence = false, onPick }: PressBoxProps) => {
    const [hovered, setHovered] = useState(false)

    const lane = { type: pedal.type, rest: y, pressed: y + ROW_HEIGHT }
    const placed = line.map(vertex => ({ x: vertex.date * stretchX, y: laneY(lane, vertex.position) }))
    const from = line[0]?.date ?? 0
    const to = line.at(-1)?.date ?? from
    const id = pedal['xml:id']

    return (
        <g
            className='pedalPress'
            data-id={`pedalPress_${id}`}
            data-evidence={evidence ? '' : undefined}
        >
            <polyline
                data-line={id}
                points={stepLine(placed, y)}
                fill='none'
                stroke={hovered ? PICKED : evidence ? EVIDENCE_COLOUR : PRESS}
                strokeWidth={hovered || evidence ? 2 : 1.5}
                pointerEvents='none'
            />
            <rect
                data-press={id}
                x={from * stretchX}
                y={y}
                width={Math.max(1, (to - from) * stretchX)}
                height={ROW_HEIGHT}
                // The faintest wash of the evidence colour, so a press reads as marked across its
                // whole span and not only where its line happens to move.
                fill={evidence ? EVIDENCE_COLOUR : 'transparent'}
                fillOpacity={evidence ? 0.08 : undefined}
                style={onPick ? { cursor: 'pointer' } : undefined}
                onMouseEnter={onPick ? () => setHovered(true) : undefined}
                onMouseLeave={onPick ? () => setHovered(false) : undefined}
                onClick={onPick ? () => onPick(pedal) : undefined}
            >
                <title>{`${onPick ? 'write ' : ''}${pedal.type} @${String(Math.round(from))}`}</title>
            </rect>
        </g>
    )
}
