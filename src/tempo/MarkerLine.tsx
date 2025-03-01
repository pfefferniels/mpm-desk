import { MouseEventHandler, useState } from "react";

type MarkerLineProps = {
  x: number;
  height: number;
  active: boolean;
  dashed: boolean;
  onClick: MouseEventHandler;
};

export const MarkerLine: React.FC<MarkerLineProps> = (props: MarkerLineProps) => {
  const [hovered, setHovered] = useState(false);
  const { x, height, active, dashed, onClick } = props;

  return <line
    className='marker'
    x1={x}
    x2={x}
    y1={0}
    y2={height}
    stroke={active ? 'red' : 'black'}
    strokeWidth={(hovered || active) ? 3 : 1}
    strokeOpacity={hovered ? 0.3 : 0.8}
    strokeDasharray={dashed ? '1 1' : undefined}
    onMouseOver={() => {
      setHovered(true);
    }}
    onMouseOut={() => {
      setHovered(false);
    }}
    onClick={onClick} />;
};
