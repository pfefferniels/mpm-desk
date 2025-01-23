import { MouseEventHandler, useState } from "react"
import { TempoSegment, asBPM } from "./Tempo"
import { Marker } from "mpmify/lib/transformers"
import { MarkerLine } from "./MarkerLine"

type BoxProps = {
  segment: TempoSegment

  stretchX: number
  stretchY: number

  onPlay: (start: number, end?: number) => void
  onStop: () => void
  played: boolean

  marker?: Marker
  onMark: () => void
  onSelectMark: () => void
  onRemoveMark: () => void

  onExpand: () => void
  onSelect: () => void
  onRemove: () => void

  splitMode: boolean
  onSplit: (first: TempoSegment, second: TempoSegment) => void
}

/**
 * Renders a single `Tempo` object into the Skyline and 
 * provides a `Dialog` to modify its appearance.
 * 
 * @prop tempo - the Tempo object to be rendered
 * @prop stretchX - horizontal stretch
 * @prop stretchY - vertical stretch
 * @prop onExpand - function called when a box is clicked with the alt key pressed
 * @prop onSelect - function called when a box is clicked
 * @prop onRemove - function called when a box is clicked with alt and shift pressed
 */
export const Box = (props: BoxProps) => {
  const [hovered, setHovered] = useState(false)
  const [markerHovered, setMarkerHovered] = useState(false)
  const [splitTime, setSplitTime] = useState<number>()
  const { segment, stretchX, stretchY, marker, onPlay, onStop, played, onMark, onSelectMark, onRemoveMark, onExpand, onSelect, onRemove, splitMode, onSplit } = props
  const { time, selected } = segment
  const { start, end } = time
  const bpm = asBPM(time)
  const upperY = bpm * -stretchY

  const handleMouseMove: MouseEventHandler<SVGPolygonElement> = e => {
    if (!splitMode) return

    const margin = 75
    const x = e.clientX - (e.target as Element).closest('svg')!.getBoundingClientRect().left - margin
    setSplitTime(x / stretchX)
  }

  const splitBoxProps: Omit<BoxProps, 'segment'> = {
    stretchX,
    stretchY,
    played,
    onPlay: () => { },
    onStop: () => { },
    onExpand: () => { },
    onMark: () => { },
    onSelectMark: () => { },
    onRemove: () => { },
    marker: undefined,
    onSelect: () => { },
    onRemoveMark: () => { },
    splitMode: false,
    onSplit: () => { }
  }

  let first: TempoSegment
  let second: TempoSegment
  if (splitTime) {
    first = {
      date: {
        start: segment.date.start,
        end: segment.date.start + (segment.date.end - segment.date.start) / 2
      },
      time: { start: segment.time.start, end: splitTime },
      selected: false,
      silent: true
    }

    second = {
      date: {
        start: segment.date.start + (segment.date.end - segment.date.start) / 2,
        end: segment.date.end
      },
      time: { start: splitTime, end: segment.time.end },
      selected: false,
      silent: true
    }
  }

  const markerLine = (
    <MarkerLine
      start={start}
      stretchX={stretchX}
      upperY={upperY}
      marker={marker}
      markerHovered={markerHovered}
      segment={segment}
      splitMode={splitMode}
      setMarkerHovered={setMarkerHovered}
      onRemoveMark={onRemoveMark}
      onMark={onMark}
      onSelectMark={onSelectMark}
      onPlay={onPlay}
      setHovered={setHovered}
    />
  )

  return (
    <g>
      {splitTime && (
        <>
          <Box
            segment={first!}
            {...splitBoxProps}
          />
          <Box
            segment={second!}
            {...splitBoxProps}
          />
        </>
      )}

      {splitMode && markerLine}

      <polygon
        className='box'
        data-start={segment.date.start}
        data-length={segment.date.end - segment.date.start}
        points={[
          [start * stretchX, 0].join(','), // start point
          [start * stretchX, upperY].join(','), // move up
          [end * stretchX, upperY].join(','), // move left
          [end * stretchX, 0].join(',')  // move down
        ].join(' ')}
        fill={played ? 'blue' : (hovered ? 'lightgray' : 'white')}
        fillOpacity={0.4}
        stroke={'black'}
        strokeDasharray={segment.silent ? '1 1' : undefined}
        strokeWidth={selected ? 2 : 1}
        onMouseMove={handleMouseMove}
        onMouseOver={() => {
          onPlay(segment.date.start, segment.date.end)
          setHovered(true)
        }}
        onMouseOut={() => {
          onStop()
          setHovered(false)
          setSplitTime(undefined)
        }}
        onClick={(e) => {
          if (splitMode) {
            onSplit(first, second)
          }
          else {
            if (e.shiftKey && e.altKey) onRemove()
            else if (e.shiftKey) onExpand()
            else onSelect()
          }
        }} />

      {!splitMode && markerLine}

      {marker?.continuous && (
        <text
          x={start * stretchX}
          y={upperY - 5}
          fontSize={10}
          textAnchor='middle'
          fill='black'
        >
          c
        </text>
      )}
    </g>
  )
}
