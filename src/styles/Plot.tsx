import { IPoint } from "mpmify/lib/utils/dbscan"

interface PlotProps {
    points: IPoint[]
    xLabel: string
    yLabel: string
    xMin: number
    xMax: number
    yMin: number
    yMax: number
    xStep: number
    yStep: number
    xStretch: number 
    yStretch: number
}

export const Plot = ({ points, xLabel, yLabel, xMin, xMax, yMin, yMax, xStep, yStep, xStretch, yStretch }: PlotProps) => {
    const screenX = (x: number) => x * xStretch
    const ticksX = []
    for (let i = xMin; i < xMax; i += xStep) {
        ticksX.push(i)
    }

    const screenY = (y: number) => yMax * yStretch - (y - yMin) * yStretch
    const ticksY = []
    for (let i = yMin; i < yMax; i += yStep) {
        ticksY.push(i)
    }

    return (
        <svg
            width={Math.abs(xMax - xMin) * xStretch}
            height={Math.abs(yMax - yMin) * yStretch}
            viewBox={`-40 0 ${screenX(xMax) + 40} ${yMax * yStretch + 40}`}>
            <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="black" />
                </marker>
            </defs>
            {/* X-axis */}
            <line x1={screenX(xMin)} y1={screenY(yMin)} x2={screenX(xMax)} y2={screenY(yMin)} stroke="black" strokeWidth="2" markerEnd="url(#arrow)" />
            {/* Y-axis */}
            <line x1="0" y1={screenY(yMin)} x2="0" y2={screenY(yMax)} stroke="black" strokeWidth="2" markerEnd="url(#arrow)" />

            {/* X-axis Ticks and Labels */}
            {ticksX.map((tick, i) => (
                <g key={`x-tick-${i}`}>
                    <line x1={tick * xStretch} y1={screenY(yMin)} x2={tick * xStretch} y2={screenY(yMin) + 5} stroke="black" strokeWidth="1" />
                    <text x={tick * xStretch} y={screenY(yMin) + 15} fontSize="10" textAnchor="middle">{tick}</text>
                </g>
            ))}

            {/* Y-axis Ticks and Labels */}
            {ticksY.map((tick, i) => (
                <g key={`y-tick-${i}`}>
                    <line x1="0" y1={screenY(tick)} x2="-10" y2={screenY(tick)} stroke="black" strokeWidth="1" />
                    <text x="-15" y={screenY(tick) + 3} fontSize="10" textAnchor="end">{tick}</text>
                </g>
            ))}

            {/* Axis Labels */}
            <text x={screenX(xMax) - 150} y={screenY(yMin) - 20} fontSize="12" fill="black">{xLabel}</text>
            <text x="20" y={screenY(yMax) + 20} fontSize="12" fill="black">{yLabel}</text>

            {points.map((p, i) => {
                const [x, y] = p.value;
                const cx = x * xStretch;
                const cy = screenY(y);

                const distinctColors = [
                    "white",
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
                ];
                const fill = p.label + 1 < distinctColors.length ? distinctColors[p.label + 1] : 'white';

                return <circle key={i} cx={cx} cy={cy} r={3} fill={fill} fillOpacity={0.5} stroke='black' strokeWidth={0.1} />;
            })}
        </svg>
    )
}