import { Marker } from "mpmify";
import { undefined } from "./Box";
import { TempoSegment } from "./Tempo";

type MarkerLineProps = {
  start: number;
  stretchX: number;
  upperY: number;
  marker: Marker | undefined;
  markerHovered: boolean;
  segment: TempoSegment;
  splitMode: boolean;
  setMarkerHovered: (hovered: boolean) => void;
  onRemoveMark: () => void;
  onMark: () => void;
  onSelectMark: () => void;
  onPlay: (start: number, end?: number) => void;
  setHovered: (hovered: boolean) => void;
};
export const MarkerLine: React.FC<MarkerLineProps> = (props: MarkerLineProps) => {
  const { start, stretchX, upperY, marker, markerHovered, segment, splitMode, setMarkerHovered, onRemoveMark, onMark, onSelectMark, onPlay, setHovered } = props;

  return <line
    className='marker'
    x1={start * stretchX}
    x2={start * stretchX}
    y1={0}
    y2={upperY}
    stroke={marker ? 'red' : 'black'}
    strokeWidth={(markerHovered || marker) ? 3 : 1}
    strokeOpacity={markerHovered ? 0.3 : 0.8}
    strokeDasharray={segment.silent ? '1 1' : undefined}
    onMouseOver={() => {
      if (splitMode) return;
      setMarkerHovered(true);
    }}
    onMouseOut={() => {
      setMarkerHovered(false);
    }}
    onClick={(e) => {
      if (e.altKey && e.shiftKey) {
        onRemoveMark();
        return;
      }

      if (!marker) {
        onMark();
      }
      else {
        onSelectMark();
        onPlay(segment.date.start);
      }
      setHovered(true);
    }} />;
};
