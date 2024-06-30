import { useCallback, useEffect, useState } from "react"
import { Box } from "./Box"
import { TempoSegment, TempoCluster, isShallowEqual, markerFromTempo, isWithinSegment } from "./Tempo"
import { TempoCurve } from "./TempoDesk"
import { Marker } from "mpmify/lib/transformers"
import { SyntheticLine } from "./SyntheticLine"
import { asMIDI } from "../utils"
import { usePiano } from "react-pianosound"
import { useNotes } from "../hooks/NotesProvider"
import { Scope } from "../DeskSwitch"

const silentSegmentToNote = (s: TempoSegment) => {
  return ({
    date: s.date.start,
    duration: s.date.end - s.date.start,
    'midi.pitch': 0,
    'midi.onset': s.time.start,
    'midi.duration': s.time.end - s.time.start,
    'midi.velocity': 0,
    'xml:id': '',
    pitchname: '',
    part: 0,
    accidentals: 0,
    octave: 0
  })
}

interface SkylineProps {
  part: Scope
  tempos: TempoCluster
  setTempos: (newTempos: TempoCluster) => void

  curves: TempoCurve[]

  stretchX: number
  stretchY: number

  markers: Marker[]
  onMark: (marker: Marker) => void
  onRemoveMarker: (marker: Marker) => void

  splitMode: boolean
  onSplit: (first: TempoSegment, second: TempoSegment) => void
}

/**
 * This component sorts the `Duration` objects by their length,
 * renders them as `Box` components, provides functionalities
 * to combine durations and change their appearances.
 * 
 */
export function Skyline({ part, tempos, setTempos, curves, markers, onMark, onRemoveMarker, stretchX, stretchY, splitMode, onSplit }: SkylineProps) {
  const { play, stop } = usePiano()
  const { slice } = useNotes()

  const [datePlayed, setDatePlayed] = useState<number>()

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
      .map(silentSegmentToNote)
    
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

  const startX = stretchX * tempos.startOnset
  const endX = stretchX * tempos.endOnset
  const width = endX - startX
  const height = -stretchY * tempos.highestBPM
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
      ].join(' ')}>
      {tempos?.sort().map((tempo: TempoSegment, index: number) => {
        const correspondingMarker = markerFromTempo(tempo)

        return (
          <Box
            key={`box${index}`}
            segment={tempo}
            stretchX={stretchX || 0}
            stretchY={stretchY || 0}
            marked={markers.findIndex(marker => isShallowEqual(marker, correspondingMarker)) !== -1}
            onPlay={handlePlay}
            onStop={stop}
            played={datePlayed ? isWithinSegment(datePlayed, tempo) : false}
            onMark={() => {
              onMark(correspondingMarker)
            }}
            onRemoveMark={() => {
              onRemoveMarker(correspondingMarker)
            }}
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
                selected.time.end = tempo.time.end
                setTempos(new TempoCluster(newTempos))
              }
            }}
            onRemove={() => {
              tempos.removeTempo(tempo)
              // make sure to leave no markers without a referenced tempo
              onRemoveMarker(correspondingMarker)
              setTempos(new TempoCluster(tempos.segments))
            }}
            splitMode={splitMode}
            onSplit={onSplit} />
        )
      })}

      {curves.map((c, i) => (
        <SyntheticLine
          key={`curve_${i}`}
          stretchX={stretchX}
          stretchY={stretchY}
          points={c}
          onPlay={() => {
            if (!c.length) return
            handlePlay(c[0].date, c[c.length - 1].date)
          }} />
      ))}
    </svg>
  )
}