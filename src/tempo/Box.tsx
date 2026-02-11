import { MouseEventHandler, useState } from "react"
import { TempoSegment, asBPM } from "./Tempo"

type BoxProps = {
  segment: TempoSegment

  tickToSeconds: (tick: number) => number
  secondsToTick: (seconds: number) => number
  stretchX: number
  stretchY: number

  onPlay: (start: number, end?: number) => void
  onStop: () => void
  played: boolean

  marker: JSX.Element | false

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
  const [splitDate, setSplitDate] = useState<number>()

  const { segment, tickToSeconds, secondsToTick, stretchX, stretchY, marker, onPlay, onStop, played, onExpand, onSelect, onRemove, splitMode, onSplit } = props
  const { selected } = segment

  const start = tickToSeconds(segment.date.start)
  const end = tickToSeconds(segment.date.end)
  const bpm = asBPM(segment.date, tickToSeconds)
  const upperY = bpm * -stretchY

  const handleMouseMove: MouseEventHandler<SVGPolygonElement> = e => {
    if (!splitMode) return

    const margin = 75
    const x = e.clientX - (e.target as Element).closest('svg')!.getBoundingClientRect().left - margin
    const seconds = x / stretchX
    setSplitDate(secondsToTick(seconds))
  }

  const splitBoxProps: Omit<BoxProps, 'segment'> = {
    tickToSeconds,
    secondsToTick,
    stretchX,
    stretchY,
    played,
    onPlay: () => { },
    onStop: () => { },
    onExpand: () => { },
    marker,
    onRemove: () => { },
    onSelect: () => { },
    splitMode: false,
    onSplit: () => { }
  }

  let first: TempoSegment
  let second: TempoSegment
  if (splitDate) {
    first = {
      date: { start: segment.date.start, end: splitDate },
      selected: false,
      silent: true
    }

    second = {
      date: { start: splitDate, end: segment.date.end },
      selected: false,
      silent: true
    }
  }

  return (
    <g>
      {splitDate && (
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

      {splitMode && marker}

      {hovered && (
        <>
          <text
            x={start * stretchX}
            y={upperY - 5}
            dominantBaseline='hanging'
            fontSize={8}
            transform={`rotate(-90, ${start * stretchX}, ${upperY - 5})`}
          >
            {segment.date.start}
          </text>
          <text
            x={end * stretchX}
            y={upperY - 5}
            fontSize={8}
            transform={`rotate(-90, ${end * stretchX}, ${upperY - 5})`}
          >
            {segment.date.end}
          </text>
            <text
            x={-10}
            y={upperY - 5}
            fontSize={10}
            textAnchor="end"
            fontWeight="bold"
            >
            {bpm.toFixed(0)}
          </text>
        </>
      )}

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
        stroke='black'
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
          setSplitDate(undefined)
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

      {!splitMode && marker}
    </g>
  )
}
