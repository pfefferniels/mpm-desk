import { useCallback, useEffect } from "react"
import { Box } from "./Box"
import { TempoSegment, TempoCluster, isShallowEqual, markerFromTempo } from "./Tempo"
import { TempoPoint } from "./TempoDesk"
import { Marker } from "mpmify/lib/transformers"
import { SyntheticLine } from "./SyntheticLine"

interface SkylineProps {
  tempos: TempoCluster
  setTempos: (newTempos: TempoCluster) => void

  points: TempoPoint[]

  stretchX: number
  stretchY: number

  markers: Marker[]
  onMark: (marker: Marker) => void
  onRemoveMarker: (marker: Marker) => void
}

/**
 * This component sorts the `Duration` objects by their length,
 * renders them as `Box` components, provides functionalities
 * to combine durations and change their appearances.
 * 
 */
export function Skyline({ tempos, setTempos, points, markers, onMark, onRemoveMarker, stretchX, stretchY }: SkylineProps) {
  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      tempos.unselectAll()
      setTempos(new TempoCluster(tempos.segments))
    }
  }, [tempos, setTempos])

  useEffect(() => {
    document.addEventListener('keydown', escFunction, false);
    return () => document.removeEventListener('keydown', escFunction, false)
  }, [tempos, escFunction])

  const startX = stretchX * tempos.start
  const endX = stretchX * tempos.end
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
            tempo={tempo}
            stretchX={stretchX || 0}
            stretchY={stretchY || 0}
            marked={markers.findIndex(marker => isShallowEqual(marker, correspondingMarker)) !== -1}
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
            }} />
        )
      })}

      <SyntheticLine
        stretchX={stretchX}
        stretchY={stretchY}
        points={points} />
    </svg>
  )
}