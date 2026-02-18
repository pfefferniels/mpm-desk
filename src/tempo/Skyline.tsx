import { useCallback, useEffect, useState } from "react"
import { Box } from "./Box"
import { TempoSegment, TempoCluster, isWithinSegment, asBPM, Onset } from "./Tempo"
import { TempoDeskMode } from "./TempoDesk"
import { asMIDI } from "../utils/utils"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import HorizontalScale from "./HorizontalScale"
import { Scope } from "../TransformerViewProps"

const silentSegmentToNote = (s: TempoSegment, tickToSeconds: (tick: number) => number) => {
  const timeStart = tickToSeconds(s.date.start)
  const timeEnd = tickToSeconds(s.date.end)
  return ({
    date: s.date.start,
    duration: s.date.end - s.date.start,
    'midi.pitch': 10,
    'midi.onset': timeStart,
    'midi.duration': timeEnd - timeStart,
    'midi.velocity': 0,
    'xml:id': '',
    pitchname: '',
    part: 0,
    accidentals: 0,
    octave: 0,
    relativeVolume: 0
  })
}

interface SkylineProps {
  mode: TempoDeskMode

  part: Scope
  tempos: TempoCluster
  setTempos: (newTempos: TempoCluster) => void

  onsets: Onset[]

  tickToSeconds: (tick: number) => number
  stretchX: number
  stretchY: number

  onAddSegment: (fromDate: number, toDate: number, beatLength: number) => void

  chainEndpoint?: { date: number, beatLength: number, bpm: number }
  onChainSegment?: (fromDate: number, toDate: number, beatLength: number) => void

  onSplit: (first: TempoSegment, second: TempoSegment, onset: number) => void
  onToggleSplitMode: () => void

  children: React.ReactNode
}

/**
 * This component sorts the `Duration` objects by their length,
 * renders them as `Box` components, provides functionalities
 * to combine durations and change their appearances.
 *
 */
export function Skyline({ part, tempos, setTempos, onsets, onAddSegment, chainEndpoint, onChainSegment, tickToSeconds, stretchX, stretchY, mode, onSplit, onToggleSplitMode, children }: SkylineProps) {
  const { play, stop } = usePiano()
  const { slice } = useNotes()

  const [datePlayed, setDatePlayed] = useState<number>()
  const [hoveredKey, setHoveredKey] = useState<string>()
  const [dragFrom, setDragFrom] = useState<{ date: number, beatLength: number, isChain?: boolean }>()
  const [dragMouse, setDragMouse] = useState<{ x: number, y: number }>()
  const [dragSnapEdge, setDragSnapEdge] = useState<{ date: number, beatLength: number, x: number, y: number }>()

  const clientToSvg = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = point.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const findNearestRightEdge = (svgX: number, snapThreshold: number, beatLength: number) => {
    let best: { date: number, beatLength: number, x: number, y: number } | undefined
    let bestDist = Infinity
    for (const segment of tempos.segments) {
      const segBeatLength = segment.date.end - segment.date.start
      const edgeX = tickToSeconds(segment.date.end) * stretchX
      const dist = Math.abs(svgX - edgeX)
      if (dist < bestDist) {
        bestDist = dist
        best = {
          date: segment.date.end,
          beatLength: segBeatLength,
          x: edgeX,
          y: asBPM({ start: segment.date.end - beatLength, end: segment.date.end }, tickToSeconds) * -stretchY
        }
      }
    }
    return bestDist <= snapThreshold ? best : undefined
  }

  const cancelDrag = () => {
    setDragFrom(undefined)
    setDragMouse(undefined)
    setDragSnapEdge(undefined)
  }

  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      tempos.unselectAll()
      setTempos(new TempoCluster(tempos.segments))
      cancelDrag()
    }
    if (event.key === 'c') {
      const selected = tempos.segments.filter(s => s.selected)
      if (selected.length >= 2) {
        const fromDate = Math.min(...selected.map(s => s.date.start))
        const toDate = Math.max(...selected.map(s => s.date.end))
        const combined: TempoSegment = {
          date: { start: fromDate, end: toDate },
          selected: false,
          silent: false
        }
        tempos.unselectAll()
        setTempos(new TempoCluster([...tempos.segments, combined]))
      }
    }
    if (event.key === 's') {
      onToggleSplitMode()
    }
  }, [tempos, setTempos, onToggleSplitMode])

  const handlePlay = (from: number, to?: number) => {
    let notes = slice(from, to)
    if (typeof part === 'number') notes = notes.filter(n => n.part - 1 === part)
    const silentNotes = tempos.segments
      .filter(s => {
        if (!s.silent) return false
        return s.date.start >= from
      })
      .map(s => silentSegmentToNote(s, tickToSeconds))

    const all = [...notes, ...silentNotes].sort((a, b) => a.date - b.date)

    const midi = asMIDI(all)
    if (midi) {
      stop()
      play(midi, (e) => {
        if (e.type === 'meta' && e.subtype === 'text') {
          setDatePlayed(+e.text)
        }
      })
    }
  }


  useEffect(() => {
    document.addEventListener('keydown', escFunction, false);
    return () => document.removeEventListener('keydown', escFunction, false)
  }, [tempos, escFunction])

  const startX = stretchX * tempos.startOnset(tickToSeconds)
  const endX = stretchX * tempos.endOnset(tickToSeconds)
  const width = endX - startX
  const height = -stretchY * tempos.highestBPM(tickToSeconds)
  const margin = 50

  return (
    <svg
      className='skyline'
      tabIndex={-1}
      onMouseDown={(e) => e.currentTarget.focus()}
      onMouseMove={(e) => {
        if (!dragFrom) return
        const svg = e.currentTarget as SVGSVGElement
        const svgPt = clientToSvg(e.clientX, e.clientY, svg)
        setDragMouse(svgPt)
        const ctm = svg.getScreenCTM()
        const snapThreshold = ctm ? 15 / ctm.a : 25
        setDragSnapEdge(findNearestRightEdge(svgPt.x, snapThreshold, dragFrom.beatLength))
      }}
      onMouseUp={() => {
        if (dragFrom && dragSnapEdge) {
          if (dragFrom.isChain) {
            onChainSegment?.(dragFrom.date, dragSnapEdge.date, dragFrom.beatLength)
          } else {
            onAddSegment(dragFrom.date, dragSnapEdge.date, dragFrom.beatLength)
          }
        }
        cancelDrag()
      }}
      onMouseLeave={() => cancelDrag()}
      onKeyDown={(e) => {
        if (e.key === 'Backspace') {
          const selected = tempos.segments.filter(s => s.selected)
          if (selected.length > 0) {
            for (const s of selected) tempos.removeTempo(s)
            setTempos(new TempoCluster(tempos.segments))
          }
        }
      }}
      style={{ margin: '3rem', outline: 'none' }}
      width={width + margin * 2}
      height={-height + margin * 2}
      viewBox={[
        startX - margin, // x
        height - margin, // y
        width + margin, // width
        -height + margin * 2 // height
      ].join(' ')}
    >
      <HorizontalScale
        stretchX={stretchX}
        offset={Math.max(...(tempos.segments.map(t => tickToSeconds(t.date.end)))) || 0}
      />

      {onsets.map((onset) => (
        <line
          key={`tick_${onset.date}`}
          x1={tickToSeconds(onset.date) * stretchX}
          x2={tickToSeconds(onset.date) * stretchX}
          y1={0}
          y2={10}
          stroke="gray"
          strokeWidth={0.5}
        />
      ))}

      {tempos?.sort(tickToSeconds).map((tempo: TempoSegment, index: number) => {
        const beatLength = tempo.date.end - tempo.date.start
        const boxKey = `${tempo.date.start}_${tempo.date.end}`
        const leftX = tickToSeconds(tempo.date.start) * stretchX
        const rightX = tickToSeconds(tempo.date.end) * stretchX
        const topY = asBPM(tempo.date, tickToSeconds) * -stretchY
        const isDragStart = dragFrom?.date === tempo.date.start && dragFrom?.beatLength === beatLength
        const isSnapTarget = dragSnapEdge?.date === tempo.date.end && dragSnapEdge?.beatLength === beatLength
        const isHovered = hoveredKey === boxKey
        const showEdges = isHovered || isDragStart || isSnapTarget
        return (
          <g
            key={`box${index}`}
            onMouseEnter={() => setHoveredKey(boxKey)}
            onMouseLeave={() => setHoveredKey(k => k === boxKey ? undefined : k)}
          >
            <Box
              segment={tempo}
              tickToSeconds={tickToSeconds}
              stretchX={stretchX || 0}
              stretchY={stretchY || 0}
              onPlay={handlePlay}
              onStop={stop}
              played={datePlayed ? isWithinSegment(datePlayed, tempo) : false}
              onSelect={() => {
                tempos.unselectAll()
                tempo.selected = true
                setTempos(new TempoCluster(tempos.segments))
              }}
              onToggleSelect={() => {
                tempo.selected = !tempo.selected
                setTempos(new TempoCluster(tempos.segments))
              }}
              onRemove={() => {
                tempos.removeTempo(tempo)
                setTempos(new TempoCluster(tempos.segments))
              }}
              splitMode={mode === 'split'}
              onSplit={onSplit}
            />
            <circle
              cx={leftX} cy={topY} r={3}
              fill={isDragStart ? 'gold' : 'transparent'}
              stroke={isDragStart ? 'gold' : 'black'}
              strokeWidth={1}
              opacity={showEdges ? 1 : 0}
              pointerEvents="all"
              style={{ cursor: dragFrom ? 'default' : 'grab' }}
              onMouseDown={(e) => {
                if (e.button !== 0) return
                setDragFrom({ date: tempo.date.start, beatLength })
              }}
            />
            <circle
              cx={rightX} cy={isSnapTarget ? (dragSnapEdge?.y ?? topY) : topY} r={3}
              fill={isSnapTarget ? 'gold' : 'transparent'}
              stroke={isSnapTarget ? 'gold' : 'black'}
              strokeWidth={1}
              opacity={showEdges ? 1 : 0}
              pointerEvents="all"
            />
          </g>
        )
      })}

      {/* Chain handle */}
      {chainEndpoint && !dragFrom && (() => {
        const cx = tickToSeconds(chainEndpoint.date) * stretchX
        const cy = chainEndpoint.bpm * -stretchY
        return (
          <circle
            cx={cx} cy={cy} r={4}
            fill='transparent'
            stroke='hsl(220, 60%, 40%)'
            strokeWidth={1.5}
            style={{ cursor: 'grab' }}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              setDragFrom({ date: chainEndpoint.date, beatLength: chainEndpoint.beatLength, isChain: true })
            }}
          />
        )
      })()}

      {/* Drag preview line */}
      {dragFrom && dragMouse && (() => {
        let fromX: number
        let fromY: number
        if (dragFrom.isChain && chainEndpoint) {
          fromX = tickToSeconds(chainEndpoint.date) * stretchX
          fromY = chainEndpoint.bpm * -stretchY
        } else {
          const fromSegment = tempos.segments.find(s => s.date.start === dragFrom.date && s.date.end - s.date.start === dragFrom.beatLength)
          if (!fromSegment) return null
          fromX = tickToSeconds(fromSegment.date.start) * stretchX
          fromY = asBPM(fromSegment.date, tickToSeconds) * -stretchY
        }
        const toX = dragSnapEdge ? dragSnapEdge.x : dragMouse.x
        const toY = dragSnapEdge ? dragSnapEdge.y : dragMouse.y
        return (
          <line
            x1={fromX} y1={fromY}
            x2={toX} y2={toY}
            stroke='gold' strokeWidth={2}
            strokeDasharray='6 4'
            pointerEvents='none'
          />
        )
      })()}

      {children}
    </svg>
  )
}
