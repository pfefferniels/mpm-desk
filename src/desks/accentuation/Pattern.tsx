import { MouseEventHandler, useState } from "react"
import { Instruction } from "../../fitting/instructions/index"
import { PULSES_PER_WHOLE } from "../../fitting/ppq"
import type { DatedTimeSignature } from "../../fitting/timeSignature"
import { Accentuation } from "./AccentuationDesk"

interface PatternProps {
    pattern: Instruction<'accentuationPattern'> & { length: number, children: Accentuation[] }
    stretchX: number
    stretchY: number
    getScreenY: (velocity: number) => number
    /** The signature governing the pattern — the beat it is counted in, and the phase it is read on. */
    signature: DatedTimeSignature | undefined
    onClick?: MouseEventHandler
    selected: boolean
}

export const Pattern = ({ pattern, stretchX, stretchY, getScreenY, signature, onClick, selected }: PatternProps) => {
    const [hovered, setHovered] = useState(false)

    const denominator = signature?.denominator ?? 4
    const beatTicks = PULSES_PER_WHOLE / denominator
    const patternTicks = pattern.length * beatTicks

    // No test for an absent number: all three are always numbers, because the def fills them in
    // while parsing. `NaN` does have to be filtered, though: espressivo parses the literal
    // `NaN` exactly as Java's `Double.parseDouble` does, and one of them would take the whole
    // `Math.min`/`Math.max` with it.
    const allPositions = pattern.children
        .map(child => [child.value, child.transitionFrom, child.transitionTo])
        .flat()
        .filter(n => !isNaN(n))

    const posMin = Math.min(...allPositions) * pattern.scale
    const posMax = Math.max(...allPositions) * pattern.scale

    /**
     * Where the renderer sounds a beat of this pattern.
     *
     * espressivo counts the pattern from the date of the time signature in force, in steps of the
     * pattern's own length (`@stickToMeasures="false"`, which is what the desk writes) — never
     * from the instruction's `@date`. So a beat sits on the grid `tsDate + k · patternTicks`, and
     * this takes its first occurrence at or after the date the pattern starts applying.
     *
     * For a cell whose start is a whole number of pattern lengths from the signature — every one
     * the desk lets you fit — that is `date + (beat − 1) · beatTicks`, which is where the beats
     * were always drawn. A pattern fitted before the desk checked (issue #47) draws off its own
     * box, which is exactly what it does when it sounds.
     */
    const tickOf = (beat: number) => {
        const raw = (signature?.date ?? 0) + (beat - 1) * beatTicks
        return raw + Math.ceil((pattern.date - raw) / patternTicks) * patternTicks
    }

    return (
        <g className="pattern" data-id={pattern.id} data-ref={pattern.accentuationPatternDefName} onClick={onClick}>
            {pattern.accentuationPatternDefName === 'neutral' && (
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
                width={patternTicks * stretchX}
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

                // No fallback needed on either read: the def has already run MPM's own chains
                // at parse time, filling a missing `@transition.from` from `@value` and a
                // missing `@transition.to` from `@transition.from`.
                const from = child.value
                const to = child.transitionTo

                return (
                    <line
                        key={`accentuation_${pattern.date}_${i}`}
                        x1={tickOf(child.beat) * stretchX}
                        y1={getScreenY(from * pattern.scale)}
                        x2={(tickOf(child.beat) + (nextBeat - child.beat) * beatTicks) * stretchX}
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
                        x={(pattern.date + patternTicks) * stretchX - 2}
                        y={getScreenY(1)}
                        width={40}
                        height={1.5 * stretchY}
                        fill="white"
                        fillOpacity={0.7}
                    />
                    <text
                        x={(pattern.date + patternTicks) * stretchX}
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