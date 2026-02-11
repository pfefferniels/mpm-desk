import { useCallback, useEffect, useState } from "react"
import { Box } from "./Box"
import { TempoSegment, TempoCluster, isWithinSegment, asBPM, Onset } from "./Tempo"
import { TempoDeskMode } from "./TempoDesk"
import { asMIDI } from "../utils/utils"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { VerticalScale } from "./VerticalScale"
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
  secondsToTick: (seconds: number) => number
  stretchX: number
  stretchY: number

  onAddSegment: (fromDate: number, toDate: number, beatLength: number) => void

  onSplit: (first: TempoSegment, second: TempoSegment) => void

  children: React.ReactNode
}

/**
 * This component sorts the `Duration` objects by their length,
 * renders them as `Box` components, provides functionalities
 * to combine durations and change their appearances.
 *
 */
export function Skyline({ part, tempos, setTempos, onsets, onAddSegment, tickToSeconds, secondsToTick, stretchX, stretchY, mode, onSplit, children }: SkylineProps) {
  const { play, stop } = usePiano()
  const { slice } = useNotes()

  const [datePlayed, setDatePlayed] = useState<number>()
  const [startMarker, setStartMarker] = useState<{ date: number, beatLength: number }>()

  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      tempos.unselectAll()
      setTempos(new TempoCluster(tempos.segments))
    }
  }, [tempos, setTempos])

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

  const handleTickClick = (onset: Onset, index: number) => {
    const isBoundary = tempos.segments.some(
      s => s.date.start === onset.date || s.date.end === onset.date
    )
    if (isBoundary) return

    const newSegments: TempoSegment[] = []

    if (index > 0) {
      const prev = onsets[index - 1]
      newSegments.push({
        date: { start: prev.date, end: onset.date },
        selected: false,
        silent: false
      })
    }

    if (index < onsets.length - 1) {
      const next = onsets[index + 1]
      newSegments.push({
        date: { start: onset.date, end: next.date },
        selected: false,
        silent: false
      })
    }

    if (newSegments.length > 0) {
      setTempos(new TempoCluster([...tempos.segments, ...newSegments]))
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
      style={{ margin: '3rem' }}
      width={width + margin * 2}
      height={-height + margin * 2}
      viewBox={[
        startX - margin, // x
        height - margin, // y
        width + margin, // width
        -height + margin * 2 // height
      ].join(' ')}
    >
      <VerticalScale
        stretchY={stretchY}
        maxTempo={Math.max(...tempos.sort().map(t => asBPM(t.date, tickToSeconds)))}
      />

      <HorizontalScale
        stretchX={stretchX}
        offset={Math.max(...(tempos.sort().map(t => tickToSeconds(t.date.end)))) || 0}
      />

      {onsets.map((onset, i) => (
        <line
          key={`tick_${onset.date}`}
          x1={tickToSeconds(onset.date) * stretchX}
          x2={tickToSeconds(onset.date) * stretchX}
          y1={0}
          y2={10}
          stroke="gray"
          strokeWidth={0.5}
          style={{ cursor: 'pointer' }}
          onClick={() => handleTickClick(onset, i)}
        />
      ))}

      {tempos?.sort(!!startMarker).map((tempo: TempoSegment, index: number) => {
        return (
          <Box
            key={`box${index}`}
            segment={tempo}
            tickToSeconds={tickToSeconds}
            secondsToTick={secondsToTick}
            stretchX={stretchX || 0}
            stretchY={stretchY || 0}
            onPlay={handlePlay}
            onStop={stop}
            played={datePlayed ? isWithinSegment(datePlayed, tempo) : false}
            marker={
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
            }
            onSelect={() => {
              tempos.unselectAll()
              const tempoClone = structuredClone(tempo)
              tempoClone.selected = true
              const newTempos = [...tempos.segments, tempoClone]
              setTempos(new TempoCluster(newTempos))
            }}
            onExpand={() => {
              const newTempos = [...tempos.segments]
              const selected = newTempos.find((d: TempoSegment) => d.selected)
              if (selected) {
                selected.date.end = tempo.date.end
                setTempos(new TempoCluster(newTempos))
              }
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

      {children}

      <style>{`
        @keyframes tempo-pulse {
          from { stroke-width: 2; }
          to { stroke-width: 5; }
        }
        .tempo-pulse-active line {
          animation: tempo-pulse 1.5s ease-in-out infinite alternate !important;
        }
      `}</style>
    </svg>
  )
}
