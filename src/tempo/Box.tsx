import { useState } from "react"
import { Tempo, asBPM } from "./Tempo"

type BoxProps = {
  tempo: Tempo

  stretchX: number
  stretchY: number

  marked: boolean
  onMark: () => void
  onRemoveMark: () => void

  onExpand: () => void
  onSelect: () => void
  onRemove: () => void
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
export function Box(props: BoxProps) {
  const [markerHovered, setMarkerHovered] = useState(false)
  const { tempo, stretchX, stretchY, marked, onMark, onRemoveMark, onExpand, onSelect, onRemove } = props
  const { date, time, selected } = tempo
  const { start, end } = date
  const bpm = asBPM(time)
  const upperY = bpm * -stretchY

  return (
    <g>
      <polygon
        className='box'
        points={[
          [start * stretchX, 0].join(','), // start point
          [start * stretchX, upperY].join(','), // move up
          [end * stretchX, upperY].join(','), // move left
          [end * stretchX, 0].join(',')  // move down
        ].join(' ')}
        fill={'white'}
        fillOpacity={0.6}
        stroke={'black'}
        strokeWidth={selected ? 2 : 1}
        onClick={(e) => {
          if (e.shiftKey && e.altKey) onRemove()
          else if (e.shiftKey) onExpand()
          else onSelect()
        }} />

      <line
        className='marker'
        x1={start * stretchX}
        x2={start * stretchX}
        y1={0}
        y2={upperY}
        stroke={marked ? 'red' : 'black'}
        strokeWidth={(markerHovered || marked) ? 3 : 1}
        strokeOpacity={markerHovered ? 0.3 : 0.8}
        onMouseOver={() => {
          setMarkerHovered(true)
        }}
        onMouseOut={() => {
          setMarkerHovered(false)
        }}
        onClick={(e) => {
          if (e.altKey && e.shiftKey) onRemoveMark()
          else onMark()
        }} />
    </g>
  )
}

