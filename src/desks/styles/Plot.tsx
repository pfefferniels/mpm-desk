import { useId } from "react"
import type { IPoint } from "../../fitting/dbscan"
import type { Axis } from "./axis"

interface PlotProps {
    points: readonly IPoint[]
    x: Axis
    y: Axis
    /** The drawing area in px. Ticks, labels and the arrowheads sit in the margin around it. */
    width: number
    height: number
    /** How big to draw one point, in px. A plot with nothing to say by size leaves this out. */
    radiusOf?: (point: IPoint) => number
}

/** Room for the tick labels and the two arrowheads, outside the drawing area. */
const margin = { left: 48, right: 20, top: 20, bottom: 34 }

/** An ornament the tolerances leave to itself: grey, so that noise still reads as a point. */
const unclustered = '#9ca3af'

const clusterColors = [
    "#556b2f",
    "#228b22",
    "#7f0000",
    "#483d8b",
    "#b8860b",
    "#008b8b",
    "#9acd32",
    "#00008b",
    "#8fbc8f",
    "#800080",
    "#b03060",
    "#ff0000",
    "#ffd700",
    "#00ff00",
    "#00ff7f",
    "#dc143c",
    "#00ffff",
    "#00bfff",
    "#0000ff",
    "#da70d6",
    "#b0c4de",
    "#ff7f50",
    "#ff00ff",
    "#1e90ff",
    "#90ee90",
    "#ff1493",
    "#7b68ee",
    "#ffe4b5",
    "#ffb6c1",
    "#696969",
]

const colorOf = (label: number): string =>
    label < 0 ? unclustered : clusterColors[label % clusterColors.length] ?? unclustered

/** A step of 1, 2 or 5 times a power of ten, giving somewhere around eight ticks over `span`. */
const tickStep = (span: number): number => {
    if (!(span > 0)) return 1
    const rough = span / 8
    const magnitude = 10 ** Math.floor(Math.log10(rough))
    const normalized = rough / magnitude
    return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude
}

const ticksOver = ({ min, max }: Axis): { value: number, label: string }[] => {
    const step = tickStep(max - min)
    const first = Math.ceil(min / step) * step
    const decimals = Math.max(0, -Math.floor(Math.log10(step)))
    return Array.from({ length: Math.floor((max - first) / step) + 1 }, (_, i) => {
        const value = first + i * step
        return { value, label: value.toFixed(decimals) }
    })
}

/**
 * A scatter plot of clustered points, in the units the caller measured them in.
 *
 * The two scales map the given range onto the drawing area, so a caller states what it wants
 * shown and nothing about pixels per unit. Both ends of a range carry: the ornamentation plot
 * measures milliseconds of roll, and most of its frame starts are negative.
 */
export const Plot = ({ points, x, y, width, height, radiusOf }: PlotProps) => {
    // Stripped, because `useId` answers in guillemets and the marker and clip are reached by
    // fragment reference. What is left still differs between two plots on one page.
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
    const screenX = (value: number) => ((value - x.min) / (x.max - x.min)) * width
    const screenY = (value: number) => ((y.max - value) / (y.max - y.min)) * height

    return (
        <svg
            width={width + margin.left + margin.right}
            height={height + margin.top + margin.bottom}
            viewBox={`${-margin.left} ${-margin.top} ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`}>
            <defs>
                <marker id={`${id}-arrow`} markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="black" />
                </marker>
                <clipPath id={`${id}-area`}>
                    <rect x={0} y={0} width={width} height={height} />
                </clipPath>
            </defs>

            <line x1={0} y1={height} x2={width} y2={height} stroke="black" strokeWidth={1} markerEnd={`url(#${id}-arrow)`} />
            <line x1={0} y1={height} x2={0} y2={0} stroke="black" strokeWidth={1} markerEnd={`url(#${id}-arrow)`} />

            {ticksOver(x).map(tick => (
                <g key={`x-tick-${tick.label}`}>
                    <line x1={screenX(tick.value)} y1={height} x2={screenX(tick.value)} y2={height + 5} stroke="black" strokeWidth={1} />
                    <text x={screenX(tick.value)} y={height + 17} fontSize="10" textAnchor="middle">{tick.label}</text>
                </g>
            ))}

            {ticksOver(y).map(tick => (
                <g key={`y-tick-${tick.label}`}>
                    <line x1={0} y1={screenY(tick.value)} x2={-5} y2={screenY(tick.value)} stroke="black" strokeWidth={1} />
                    <text x={-10} y={screenY(tick.value) + 3} fontSize="10" textAnchor="end">{tick.label}</text>
                </g>
            ))}

            <text x={width} y={height + 31} fontSize="12" textAnchor="end">{x.label}</text>
            <text x={0} y={-7} fontSize="12">{y.label}</text>

            <g clipPath={`url(#${id}-area)`}>
                {points.map((point, i) => {
                    // An articulation the fit could not place carries no coordinates at all, and
                    // keeps its slot in the list so that the labels stay aligned with it.
                    const [atX, atY] = point.value
                    if (atX === undefined || atY === undefined) return null

                    return (
                        <circle
                            key={i}
                            cx={screenX(atX)}
                            cy={screenY(atY)}
                            r={radiusOf ? radiusOf(point) : 4}
                            fill={colorOf(point.label)}
                            fillOpacity={0.5}
                            stroke="black"
                            strokeWidth={0.5}
                        />
                    )
                })}
            </g>
        </svg>
    )
}
