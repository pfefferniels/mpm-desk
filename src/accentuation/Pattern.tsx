import { MouseEventHandler, useState } from "react"
import { Accentuation, AccentuationPattern } from "../../../mpm-ts/lib"

interface PatternProps {
    pattern: AccentuationPattern & { scale: number, length: number, children: Accentuation[] }
    stretchX: number
    stretchY: number
    getScreenY: (velocity: number) => number
    denominator: number
    onClick?: MouseEventHandler
    selected: boolean
}

export const Pattern = ({ pattern, stretchX, stretchY, getScreenY, denominator, onClick, selected }: PatternProps) => {
    const [hovered, setHovered] = useState(false)

    const allPositions = pattern.children
        .map(child => [child.value, child["transition.from"], child["transition.to"]])
        .flat()
        .filter(n => n !== undefined && !isNaN(n))

    const posMin = Math.min(...allPositions) * pattern.scale
    const posMax = Math.max(...allPositions) * pattern.scale

    const beatToTick = (beat: number) => {
        return ((beat - 1) * 4 * 720) / denominator
    }

    return (
        <g className="pattern" onClick={onClick}>
            {pattern["name.ref"] === 'neutral' && (
                <line
                    x1={pattern.date * stretchX}
                    y1={getScreenY(2)}
                    x2={pattern.date * stretchX}
                    y2={getScreenY(-2)}
                    stroke='red'
                    strokeWidth={2}
                />
            )}

            <rect
                x={pattern.date * stretchX}
                y={getScreenY(posMax)}
                width={((pattern.length * 4 * 720 / denominator) * stretchX)}
                height={getScreenY(posMin) - getScreenY(posMax)}
                fill='red'
                fillOpacity={(hovered || selected) ? 0.6 : 0.2}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                strokeWidth={0.8}
                stroke='black'
                strokeDasharray={'5 5'}
            />

            {hovered && (
                <text
                    x={pattern.date * stretchX - 5}
                    y={getScreenY(posMin + (posMax - posMin) / 2)}
                    fontSize={10}
                    fill="black"
                >
                    {pattern.scale.toFixed(0)}
                </text>
            )}

            {pattern.children.map((child, i) => {
                const nextBeat = i === pattern.children.length - 1
                    ? (pattern.length + 1)
                    : pattern.children[i + 1].beat

                let from = child.value
                if (from === undefined) from = child["transition.from"]

                let to = child["transition.to"]
                if (to === undefined) to = child["transition.from"]
                if (to === undefined) to = child.value

                return (
                    <line
                        key={`accentuation_${pattern.date}_${i}`}
                        x1={(pattern.date + beatToTick(child.beat)) * stretchX}
                        y1={getScreenY(from * pattern.scale)}
                        x2={(pattern.date + beatToTick(nextBeat)) * stretchX}
                        y2={getScreenY(to * pattern.scale)}
                        fill='red'
                        fillOpacity={0.5}
                        strokeWidth={1}
                        stroke='black'
                    />
                )
            })}

            {(hovered && pattern.loop) && (
                <g>
                    <rect
                        x={(pattern.date + (pattern.length * 4 * 720) / denominator) * stretchX - 2}
                        y={getScreenY(1)}
                        width={40}
                        height={1.5 * stretchY}
                        fill="white"
                        fillOpacity={0.7}
                    />
                    <text
                        x={(pattern.date + (pattern.length * 4 * 720) / denominator) * stretchX}
                        y={getScreenY(0)}
                        fontSize={10}
                        fill="black"
                    >
                        loop →
                    </text>
                </g>
            )}
        </g>
    )
}