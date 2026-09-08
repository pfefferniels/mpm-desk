import { useState } from 'react'
import type { AlignedPedal } from '../../fitting/alignment'
import type { TickVertex } from '../../fitting/transformers/tempo/tickTimes'
import { laneY, stepLine } from '../pedalGeometry'
import { ROW_HEIGHT } from './layout'

const PRESS = '#4b5563'
const PICKED = 'hsl(220, 60%, 50%)'

interface PressBoxProps {
    pedal: AlignedPedal
    /** The line the press recorded, on the tick grid. */
    line: readonly TickVertex[]
    /** The top of the row it is drawn on. */
    y: number
    stretchX: number
    onPick: (pedal: AlignedPedal) => void
}

/**
 * One recorded press, drawn as the line it recorded: at rest along the top of its row, a full
 * stroke down at the bottom, held between vertices the way a controller value is.
 *
 * A click writes the whole line as movements, so the press is one target. The line itself takes
 * no pointer events; the box it encloses does.
 */
export const PressBox = ({ pedal, line, y, stretchX, onPick }: PressBoxProps) => {
    const [hovered, setHovered] = useState(false)

    const lane = { type: pedal.type, rest: y, pressed: y + ROW_HEIGHT }
    const placed = line.map(vertex => ({ x: vertex.date * stretchX, y: laneY(lane, vertex.position) }))
    const from = line[0]?.date ?? 0
    const to = line.at(-1)?.date ?? from
    const id = pedal['xml:id']

    return (
        <g className='pedalPress' data-id={`pedalPress_${id}`}>
            <polyline
                data-line={id}
                points={stepLine(placed, y)}
                fill='none'
                stroke={hovered ? PICKED : PRESS}
                strokeWidth={hovered ? 2 : 1.5}
                pointerEvents='none'
            />
            <rect
                data-press={id}
                x={from * stretchX}
                y={y}
                width={Math.max(1, (to - from) * stretchX)}
                height={ROW_HEIGHT}
                fill='transparent'
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={() => onPick(pedal)}
            >
                <title>{`write ${pedal.type} @${String(Math.round(from))}`}</title>
            </rect>
        </g>
    )
}
