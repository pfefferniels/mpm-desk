import { useCallback, useEffect, useMemo, useState } from "react"
import { Box } from "./Box"
import { TempoCluster } from "./Tempo"
import type { TempoSegment, Onset, DrawnLine } from "./Tempo"
import { inferBeatLength, beatLengthLabel, findOnsetTick } from "./Tempo"
import { fitMeanTempoAt, optimizeForElapsedTime } from "mpmify"
import { TempoLine } from "./TempoLine"
import HorizontalScale from "./HorizontalScale"
import type { TempoWithEndDate, MSM } from "mpmify"
import type { MidiFile } from "midifile-ts"
import type { Scope } from "../TransformerViewProps"

export type SkylineMode = 'split' | 'draw' | undefined

interface SkylineProps {
  mode: SkylineMode

  part: Scope
  tempos: TempoCluster
  setTempos: (newTempos: TempoCluster) => void

  onsets: Onset[]

  tickToSeconds: (tick: number) => number
  stretchX: number
  stretchY: number

  committedTempos: TempoWithEndDate[]
  silentOnsets: Map<number, number>
  msm: MSM

  drawnLines: DrawnLine[]
  onDrawLine: (line: DrawnLine) => void

  onSplit: (first: TempoSegment, second: TempoSegment, onset: number) => void
  onToggleSplitMode: () => void

  onPlaySegment?: (from: number, to: number) => void
  onStopSegment?: () => void

  activeElements?: string[]
  onActivateElement?: (elementId: string) => void

  onPlayChain?: (chain: TempoWithEndDate[], midi: MidiFile | undefined) => void
  onStopChain?: () => void

  committedChains: TempoWithEndDate[][]
  committedChainMidis: (MidiFile | undefined)[]
  tempoToChainIndex: Map<TempoWithEndDate, number>
}

export function Skyline({ part, tempos, setTempos, onsets, drawnLines, onDrawLine, tickToSeconds, stretchX, stretchY, mode, onSplit, onToggleSplitMode, onPlaySegment, onStopSegment, activeElements, onActivateElement, committedTempos, silentOnsets, msm, onPlayChain, onStopChain, committedChains, committedChainMidis, tempoToChainIndex }: SkylineProps) {
  const [, setHoveredKey] = useState<string>()
  const [drawStart, setDrawStart] = useState<{ x: number, y: number }>()
  const [drawEnd, setDrawEnd] = useState<{ x: number, y: number }>()
  const [drawTrail, setDrawTrail] = useState<{ seconds: number, bpm: number }[]>([])
  const [hoveredEndpoint, setHoveredEndpoint] = useState<number>()
  const [connectingFrom, setConnectingFrom] = useState<number>()

  const isDrawMode = mode === 'draw'

  const onsetXPositions = useMemo(
    () => onsets.map(o => tickToSeconds(o.date) * stretchX),
    [onsets, tickToSeconds, stretchX]
  )

  const snapX = (svgX: number): number => {
    let best = svgX
    let bestDist = Infinity
    for (const ox of onsetXPositions) {
      const dist = Math.abs(svgX - ox)
      if (dist < bestDist) {
        bestDist = dist
        best = ox
      }
    }
    return best
  }

  const clientToSvg = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = point.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const cancelDraw = () => {
    setDrawStart(undefined)
    setDrawEnd(undefined)
    setDrawTrail([])
    setConnectingFrom(undefined)
  }

  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      tempos.unselectAll()
      setTempos(new TempoCluster(tempos.segments))
      cancelDraw()
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
      style={{ margin: '3rem', outline: 'none', cursor: isDrawMode ? 'crosshair' : undefined }}
      onMouseDown={(e) => {
        e.currentTarget.focus()
        if (!isDrawMode || e.button !== 0) return
        const svg = e.currentTarget as SVGSVGElement
        const pt = clientToSvg(e.clientX, e.clientY, svg)
        const snapped = { x: snapX(pt.x), y: pt.y }
        setDrawStart(snapped)
        setDrawEnd(snapped)
        setDrawTrail([])
      }}
      onMouseMove={(e) => {
        if (!drawStart) return
        const svg = e.currentTarget as SVGSVGElement
        const pt = clientToSvg(e.clientX, e.clientY, svg)
        setDrawEnd({ x: snapX(pt.x), y: pt.y })
        setDrawTrail(prev => [...prev, { seconds: pt.x / stretchX, bpm: -pt.y / stretchY }])
      }}
      onMouseUp={() => {
        if (drawStart && drawEnd && drawStart.x !== drawEnd.x) {
          const from = { seconds: drawStart.x / stretchX, bpm: -drawStart.y / stretchY }
          const to = { seconds: drawEnd.x / stretchX, bpm: -drawEnd.y / stretchY }
          const meanTempoAt = fitMeanTempoAt(from, to, drawTrail)
          const beatLen = connectingFrom !== undefined
            ? drawnLines[connectingFrom].beatLength
            : inferBeatLength(from.seconds, from.bpm, onsets, tickToSeconds)

          const startTick = findOnsetTick(from.seconds, onsets, tickToSeconds)
          const endTick = findOnsetTick(to.seconds, onsets, tickToSeconds)

          if (startTick !== undefined && endTick !== undefined && startTick !== endTick) {
            const targetMs = Math.abs(to.seconds - from.seconds) * 1000
            const opt = optimizeForElapsedTime(
              from.bpm, to.bpm, meanTempoAt, beatLen,
              startTick, endTick, targetMs
            )
            onDrawLine({
              from: { seconds: from.seconds, bpm: opt.startBpm },
              to: { seconds: to.seconds, bpm: opt.endBpm },
              meanTempoAt: opt.meanTempoAt,
              beatLength: beatLen,
              bpmScaled: opt.bpmScaled,
              startTick,
              endTick
            })
          } else {
            onDrawLine({ from, to, meanTempoAt, beatLength: beatLen, startTick, endTick })
          }
        }
        cancelDraw()
      }}
      onMouseLeave={() => cancelDraw()}
      onKeyDown={(e) => {
        if (e.key === 'Backspace') {
          const selected = tempos.segments.filter(s => s.selected)
          if (selected.length > 0) {
            for (const s of selected) tempos.removeTempo(s)
            setTempos(new TempoCluster(tempos.segments))
          }
        }
      }}
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
        const boxKey = `${tempo.date.start}_${tempo.date.end}`
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
              onPlay={onPlaySegment}
              onStop={onStopSegment}
              onSelect={() => {
                if (isDrawMode) return
                tempos.unselectAll()
                tempo.selected = true
                setTempos(new TempoCluster(tempos.segments))
              }}
              onToggleSelect={() => {
                if (isDrawMode) return
                tempo.selected = !tempo.selected
                setTempos(new TempoCluster(tempos.segments))
              }}
              onRemove={() => {
                tempos.removeTempo(tempo)
                setTempos(new TempoCluster(tempos.segments))
              }}
              splitMode={mode === 'split'}
              onSplit={onSplit}
              drawMode={isDrawMode}
            />
          </g>
        )
      })}

      {/* Committed tempo curves */}
      {committedTempos.map((t, i) => {
        let startTime: number | undefined = msm.notesAtDate(t.date, part)[0]?.['midi.onset']
        if (startTime === undefined) {
          startTime = silentOnsets.get(t.date)
        }

        const chainIndex = tempoToChainIndex.get(t)
        const chain = chainIndex !== undefined ? committedChains[chainIndex] : undefined

        return (
          <TempoLine
            key={`tempo_${i}`}
            tempo={t}
            startTime={startTime || 0}
            stretchX={stretchX}
            stretchY={stretchY}
            active={activeElements?.includes(t['xml:id'])}
            onClick={onActivateElement ? () => onActivateElement(t['xml:id']) : undefined}
            onMouseEnter={chain && onPlayChain ? () => onPlayChain(chain, committedChainMidis[chainIndex!]) : undefined}
            onMouseLeave={onStopChain}
          />
        )
      })}

      {/* Committed drawn curves */}
      {drawnLines.map((dl, i) => {
        const p = Math.log(0.5) / Math.log(dl.meanTempoAt)
        const numSamples = 50
        const points: string[] = []
        for (let j = 0; j <= numSamples; j++) {
          const x = j / numSamples
          const seconds = dl.from.seconds + x * (dl.to.seconds - dl.from.seconds)
          const bpm = dl.from.bpm + Math.pow(x, p) * (dl.to.bpm - dl.from.bpm)
          points.push(`${seconds * stretchX},${bpm * -stretchY}`)
        }
        const startX2 = dl.from.seconds * stretchX
        const startY = dl.from.bpm * -stretchY
        const endX2 = dl.to.seconds * stretchX
        const endY = dl.to.bpm * -stretchY
        const isEndHovered = hoveredEndpoint === i
        const midSeconds = (dl.from.seconds + dl.to.seconds) / 2
        const midBpm = dl.from.bpm + Math.pow(0.5, p) * (dl.to.bpm - dl.from.bpm)
        const prev = drawnLines[i - 1]
        const isConnected = prev && prev.to.seconds === dl.from.seconds && prev.to.bpm === dl.from.bpm
        return (
          <g key={`drawn_${i}`}>
            <polyline
              points={points.join(' ')}
              fill='none'
              stroke='hsl(220, 60%, 40%)' strokeWidth={2}
              pointerEvents='none'
            />
            {/* Beat length label */}
            <text
              x={midSeconds * stretchX}
              y={midBpm * -stretchY - 8}
              fontSize={8}
              textAnchor='middle'
              fill='hsl(220, 60%, 40%)'
              pointerEvents='none'
            >
              {beatLengthLabel(dl.beatLength)}
            </text>
            {/* BPM labels at start and end (skip start if connected to previous curve) */}
            {!isConnected && <text
              x={startX2}
              y={startY - 8}
              fontSize={7}
              textAnchor='start'
              fill={dl.bpmScaled ? 'hsl(30, 80%, 45%)' : 'hsl(220, 60%, 40%)'}
              opacity={0.7}
              pointerEvents='none'
            >
              {dl.bpmScaled ? '~' : ''}{dl.from.bpm.toFixed(1)}
            </text>}
            <text
              x={endX2}
              y={endY - 8}
              fontSize={7}
              textAnchor='end'
              fill={dl.bpmScaled ? 'hsl(30, 80%, 45%)' : 'hsl(220, 60%, 40%)'}
              opacity={0.7}
              pointerEvents='none'
            >
              {dl.bpmScaled ? '~' : ''}{dl.to.bpm.toFixed(1)}
            </text>
            {/* Continuation handle at endpoint */}
            {isDrawMode && !drawStart && (
              <circle
                cx={endX2} cy={endY} r={4}
                fill={isEndHovered ? 'gold' : 'transparent'}
                stroke={isEndHovered ? 'gold' : 'hsl(220, 60%, 40%)'}
                strokeWidth={1.5}
                opacity={isEndHovered ? 1 : 0.6}
                style={{ cursor: 'grab' }}
                pointerEvents="all"
                onMouseEnter={() => setHoveredEndpoint(i)}
                onMouseLeave={() => setHoveredEndpoint(undefined)}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  const start = { x: endX2, y: endY }
                  setDrawStart(start)
                  setDrawEnd(start)
                  setDrawTrail([])
                  setConnectingFrom(i)
                }}
              />
            )}
          </g>
        )
      })}

      {/* Draw preview curve (with live optimizer) */}
      {drawStart && drawEnd && drawStart.x !== drawEnd.x && (() => {
        const rawFrom = { seconds: drawStart.x / stretchX, bpm: -drawStart.y / stretchY }
        const rawTo = { seconds: drawEnd.x / stretchX, bpm: -drawEnd.y / stretchY }
        const im = fitMeanTempoAt(rawFrom, rawTo, drawTrail)
        const beatLen = connectingFrom !== undefined
          ? drawnLines[connectingFrom].beatLength
          : inferBeatLength(rawFrom.seconds, rawFrom.bpm, onsets, tickToSeconds)
        const sTick = findOnsetTick(rawFrom.seconds, onsets, tickToSeconds)
        const eTick = findOnsetTick(rawTo.seconds, onsets, tickToSeconds)

        let from = rawFrom, to = rawTo, finalIm = im, scaled = false
        if (sTick !== undefined && eTick !== undefined && sTick !== eTick) {
          const targetMs = Math.abs(rawTo.seconds - rawFrom.seconds) * 1000
          const opt = optimizeForElapsedTime(rawFrom.bpm, rawTo.bpm, im, beatLen, sTick, eTick, targetMs)
          from = { seconds: rawFrom.seconds, bpm: opt.startBpm }
          to = { seconds: rawTo.seconds, bpm: opt.endBpm }
          finalIm = opt.meanTempoAt
          scaled = opt.bpmScaled
        }

        const p = Math.log(0.5) / Math.log(finalIm)
        const numSamples = 50
        const points: string[] = []
        for (let j = 0; j <= numSamples; j++) {
          const x = j / numSamples
          const seconds = from.seconds + x * (to.seconds - from.seconds)
          const bpm = from.bpm + Math.pow(x, p) * (to.bpm - from.bpm)
          points.push(`${seconds * stretchX},${bpm * -stretchY}`)
        }
        return (
          <g>
            <polyline
              points={points.join(' ')}
              fill='none'
              stroke='gold' strokeWidth={2}
              strokeDasharray='6 4'
              pointerEvents='none'
            />
            <text
              x={from.seconds * stretchX}
              y={from.bpm * -stretchY - 8}
              fontSize={7} textAnchor='start'
              fill={scaled ? 'hsl(30, 80%, 45%)' : 'gold'}
              pointerEvents='none'
            >
              {scaled ? '~' : ''}{from.bpm.toFixed(1)}
            </text>
            <text
              x={to.seconds * stretchX}
              y={to.bpm * -stretchY - 8}
              fontSize={7} textAnchor='end'
              fill={scaled ? 'hsl(30, 80%, 45%)' : 'gold'}
              pointerEvents='none'
            >
              {scaled ? '~' : ''}{to.bpm.toFixed(1)}
            </text>
            <text
              x={(from.seconds + to.seconds) / 2 * stretchX}
              y={(from.bpm + Math.pow(0.5, p) * (to.bpm - from.bpm)) * -stretchY - 8}
              fontSize={8} textAnchor='middle'
              fill='gold'
              pointerEvents='none'
            >
              {beatLengthLabel(beatLen)}
            </text>
          </g>
        )
      })()}
    </svg>
  )
}
