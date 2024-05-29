import { Point, TempoWithSegmentData } from "../experiments/BezierApproach";

function randomColor(): string {
    // Generate random values for Red, Green, and Blue components
    const red = Math.floor(Math.random() * 256); // 0 to 255
    const green = Math.floor(Math.random() * 256); // 0 to 255
    const blue = Math.floor(Math.random() * 256); // 0 to 255

    const opacity = 0.3;

    // Return the color in 'rgba(r, g, b, a)' format
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}


interface SegmentProps {
    segment: TempoWithSegmentData
    toSVG: (p: Point) => Point
}

export const Segment = ({ segment, toSVG }: SegmentProps) => {
    const begin = segment.date
    const end = segment.endDate

    return (
        <>
            <rect
                x={toSVG([begin, 0])[0]}
                y={0}
                width={toSVG([end, 0])[0] - toSVG([begin, 0])[0]}
                height={500}
                fill={randomColor()}
                onMouseEnter={() => console.log(segment)} />

            <line
                x1={toSVG([end, 0])[0]}
                x2={toSVG([end, 0])[0]}
                y1={0}
                y2={500}
                stroke='black'
                strokeDasharray={3}
                 />
        </>
    )
}
