import { useCallback, useEffect, useState } from "react"
import { Box } from "./Box"
import { TempoSegment, TempoCluster, isWithinSegment, asBPM, Onset } from "./Tempo"
import { TempoDeskMode } from "./TempoDesk"
import { asMIDI } from "../utils/utils"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import HorizontalScale from "./HorizontalScale"
import { MarkerLine } from "./MarkerLine"
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
export function Skyline({ part, tempos, setTempos, onsets, onAddSegment, tickToSeconds, stretchX, stretchY, mode, onSplit, onToggleSplitMode, children }: SkylineProps) {
  const { play, stop } = usePiano()
  const { slice } = useNotes()

  const [datePlayed, setDatePlayed] = useState<number>()
  const [startMarker, setStartMarker] = useState<{ date: number, beatLength: number }>()
  const [dragFromOnset, setDragFromOnset] = useState<Onset>()
  const [dragToOnset, setDragToOnset] = useState<Onset>()

  const clientToSvgX = (clientX: number, svg: SVGSVGElement) => {
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = 0
    const ctm = svg.getScreenCTM()
    if (!ctm) return 0
    return point.matrixTransform(ctm.inverse()).x
  }

  const findNearestOnset = (svgX: number): Onset | undefined => {
    let best: Onset | undefined
    let bestDist = Infinity
    for (const onset of onsets) {
      const onsetX = tickToSeconds(onset.date) * stretchX
      const dist = Math.abs(svgX - onsetX)
      if (dist < bestDist) {
        bestDist = dist
        best = onset
      }
    }
    return best
  }

  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      tempos.unselectAll()
      setTempos(new TempoCluster(tempos.segments))
      setDragFromOnset(undefined)
      setDragToOnset(undefined)
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
        if (!dragFromOnset) return
        const svgX = clientToSvgX(e.clientX, e.currentTarget as SVGSVGElement)
        const nearest = findNearestOnset(svgX)
        setDragToOnset(nearest && nearest.date !== dragFromOnset.date ? nearest : undefined)
      }}
      onMouseUp={() => {
        if (dragFromOnset && dragToOnset) {
          const start = Math.min(dragFromOnset.date, dragToOnset.date)
          const end = Math.max(dragFromOnset.date, dragToOnset.date)
          setTempos(new TempoCluster([...tempos.segments, {
            date: { start, end },
            selected: false,
            silent: false
          }]))
        }
        setDragFromOnset(undefined)
        setDragToOnset(undefined)
      }}
      onMouseLeave={() => {
        setDragFromOnset(undefined)
        setDragToOnset(undefined)
      }}
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

      {onsets.map((onset) => {
        const isDragFrom = dragFromOnset?.date === onset.date
        const isDragTo = dragToOnset?.date === onset.date
        const highlighted = isDragFrom || isDragTo
        return (
          <line
            key={`tick_${onset.date}`}
            x1={tickToSeconds(onset.date) * stretchX}
            x2={tickToSeconds(onset.date) * stretchX}
            y1={highlighted ? -10 : 0}
            y2={10}
            stroke={highlighted ? 'gold' : 'gray'}
            strokeWidth={highlighted ? 1.5 : 0.5}
            style={{ cursor: dragFromOnset ? 'grabbing' : 'grab' }}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              setDragFromOnset(onset)
            }}
          />
        )
      })}

      {tempos?.sort(tickToSeconds).map((tempo: TempoSegment, index: number) => {
        return (
          <Box
            key={`box${index}`}
            segment={tempo}
            tickToSeconds={tickToSeconds}
            stretchX={stretchX || 0}
            stretchY={stretchY || 0}
            onPlay={handlePlay}
            onStop={stop}
            played={datePlayed ? isWithinSegment(datePlayed, tempo) : false}
            marker={
              <>
                <MarkerLine
                  x={((startMarker === undefined || startMarker.date === tempo.date.start) ? tickToSeconds(tempo.date.start) : tickToSeconds(tempo.date.end)) * stretchX}
                  height={asBPM(tempo.date, tickToSeconds) * -stretchY}
                  dashed={tempo.silent}
                  active={startMarker?.date === tempo.date.start}
                  onClick={e => {
                    if (e.shiftKey && e.altKey) setStartMarker(undefined)
                    else {
                      if (startMarker) {
                        onAddSegment(startMarker.date, tempo.date.end, startMarker.beatLength)
                        setStartMarker(undefined)
                      }
                      else {
                        setStartMarker({ date: tempo.date.start, beatLength: tempo.date.end - tempo.date.start })
                      }
                    }
                  }}
                />
                {startMarker?.date === tempo.date.start && (
                  <MarkerLine
                    x={tickToSeconds(tempo.date.end) * stretchX}
                    height={asBPM(tempo.date, tickToSeconds) * -stretchY}
                    dashed={tempo.silent}
                    active={false}
                    onClick={() => {
                      onAddSegment(startMarker.date, tempo.date.end, startMarker.beatLength)
                      setStartMarker(undefined)
                    }}
                  />
                )}
              </>
            }
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
        )
      })}

      {dragFromOnset && dragToOnset && (() => {
        const start = Math.min(dragFromOnset.date, dragToOnset.date)
        const end = Math.max(dragFromOnset.date, dragToOnset.date)
        const x1 = tickToSeconds(start) * stretchX
        const x2 = tickToSeconds(end) * stretchX
        const bpm = asBPM({ start, end }, tickToSeconds)
        const upperY = bpm * -stretchY
        return (
          <polygon
            points={[
              [x1, 0].join(','),
              [x1, upperY].join(','),
              [x2, upperY].join(','),
              [x2, 0].join(',')
            ].join(' ')}
            fill='gold'
            fillOpacity={0.2}
            stroke='gold'
            strokeDasharray='4 2'
            strokeWidth={1}
            pointerEvents='none'
          />
        )
      })()}

      {children}
    </svg>
  )
}
