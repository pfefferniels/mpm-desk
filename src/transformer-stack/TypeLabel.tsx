const LABEL_CHAR_WIDTH = 6.4;
const LABEL_HORIZONTAL_PADDING = 5;
const LABEL_HEIGHT = 16;
const LABEL_RADIUS = 4;
const LABEL_FONT_SIZE = 10;
const LABEL_FONT_WEIGHT = "600";

function labelBoxMetrics(text: string) {
    const width = text.length * LABEL_CHAR_WIDTH + LABEL_HORIZONTAL_PADDING * 2;
    return {
        x: -width / 2,
        width,
    };
}

interface TypeLabelProps {
    text: string;
    color: string;
    boxY: number;
    textY: number;
}

export function TypeLabel({ text, color, boxY, textY }: TypeLabelProps) {
    const box = labelBoxMetrics(text);
    return (
        <>
            <rect
                x={box.x}
                y={boxY}
                width={box.width}
                height={LABEL_HEIGHT}
                rx={LABEL_RADIUS}
                fill="white"
                fillOpacity={0.92}
                stroke={color}
                strokeWidth={1}
                strokeOpacity={0.4}
                vectorEffect="non-scaling-stroke"
            />
            <text
                x={0}
                y={textY}
                textAnchor="middle"
                fontSize={LABEL_FONT_SIZE}
                fill={color}
                fontWeight={LABEL_FONT_WEIGHT}
            >
                {text}
            </text>
        </>
    );
}
