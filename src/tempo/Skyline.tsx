import { useCallback, useEffect } from "react"
import { Box } from "./Box"
import { Tempo, TempoCluster } from "./Tempo"

type SkylineProps = {
  tempos: TempoCluster
  setTempos: (newTempos: TempoCluster) => void
  stretchX: number
  stretchY: number
  onMarkSegmentStart: (atTempo: Tempo) => void
}

/**
 * This component sorts the `Duration` objects by their length,
 * renders them as `Box` components, provides functionalities
 * to combine durations and change their appearances.
 * 
 */
export function Skyline(props: SkylineProps) {
  const { tempos, setTempos, onMarkSegmentStart, stretchX, stretchY } = props

  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      tempos.unselectAll()
      setTempos(new TempoCluster(tempos.tempos))
    }
  }, [tempos, setTempos])

  useEffect(() => {
    document.addEventListener('keydown', escFunction, false);
    return () => document.removeEventListener('keydown', escFunction, false)
  }, [tempos, escFunction])

  const startX = stretchX * tempos.start()
  const endX = stretchX * tempos.end()
  const width = endX  - startX
  const height = -stretchY * tempos.highestBPM()
  const margin = 50

  return (
    <svg
      className='butterfly'
      style={{ margin: '3rem' }}
      width={width + margin * 2}
      height={-height + margin * 2}
      viewBox={[
        startX - margin, // x
        height - margin, // y
        width + margin, // width
        -height + margin * 2 // height
      ].join(' ')}>
      {tempos?.sort().map((tempo: Tempo, index: number) => {
        return (
          <Box
            key={`box${index}`}
            tempo={tempo}
            stretchX={props.stretchX || 0}
            stretchY={props.stretchY || 0}
            onMark={() => {
              onMarkSegmentStart(tempo)
            }}
            onSelect={() => {
              tempos.unselectAll()
              const tempoClone = structuredClone(tempo)
              tempoClone.selected = true
              const newTempos = [...tempos.tempos, tempoClone]
              setTempos(new TempoCluster(newTempos))
            }}
            onExpand={() => {
              const newTempos = [...tempos.tempos]
              const selected = newTempos.find((d: Tempo) => d.selected)
              if (selected) {
                selected.date.end = tempo.date.end
                selected.time.end = tempo.time.end
                setTempos(new TempoCluster(newTempos))
              }
            }}
            onRemove={() => {
              tempos.removeTempo(tempo)
              setTempos(new TempoCluster(tempos.tempos))
            }} />
        )
      })}
    </svg>
  )
}