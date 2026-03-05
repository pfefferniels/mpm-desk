import { Button, Stack, ToggleButton } from "@mui/material"
import { computeMillisecondsAt, SilentOnset, TranslatePhyiscalTimeToTicks } from "mpmify"
import type { TempoWithEndDate } from "mpmify"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Skyline } from "./Skyline"
import type { SkylineMode } from "./Skyline"
import { TempoCluster, extractTempoSegments, extractOnsets, resolveOverlaps } from "./Tempo"
import type { TempoSegment as LocalTempoSegment, DrawnLine } from "./Tempo"
import { VerticalScale } from "./VerticalScale"
import { ZoomControls } from "../../components/ZoomControls"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { Add, Merge } from "@mui/icons-material"
import { Ribbon } from "../../components/Ribbon"
import { createPortal } from "react-dom"
import { MPM, Tempo } from "../../../../mpm-ts/lib"
import { usePhysicalZoom } from "../../hooks/ZoomProvider"
import { useSelection } from "../../hooks/SelectionProvider"
import { useScrollSync } from "../../hooks/ScrollSyncProvider"
import { useTimeMapping } from "../../hooks/useTimeMapping"
import { usePiano } from "react-pianosound"
import { useNotes } from "../../hooks/NotesProvider"
import { asMIDI } from "../../utils/utils"
import { MidiFile } from "midifile-ts"
import { InsertTempo } from "../../transformers/InsertTempo"

type TempoWithOptionalEndDate = Tempo & { endDate?: number }

export type TempoSecondaryData = {
    tempoCluster?: LocalTempoSegment[]
    silentOnsets?: SilentOnset[]
    drawnLines?: DrawnLine[]
}

type TempoPoint = {
    date: number
    time: number
    bpm: number
}

type TempoDeskMode = SkylineMode

export const TempoDesk = ({ msm, mpm, addTransformer, part, appBarRef, secondary, setSecondary }: ScopedTransformerViewProps<TranslatePhyiscalTimeToTicks | InsertTempo>) => {
    const { activeElements, setActiveElement } = useSelection()
    const tempoData = secondary?.tempo

    const [tempoCluster, setTempoClusterState] = useState<TempoCluster>(() => {
        if (tempoData?.tempoCluster && tempoData.tempoCluster.length > 0) {
            return new TempoCluster(tempoData.tempoCluster)
        }
        return new TempoCluster()
    })
    const [silentOnsets, setSilentOnsetsState] = useState<Map<number, number>>(
        () => new Map((tempoData?.silentOnsets ?? []).map(o => [o.date, o.onset]))
    )

    const silentOnsetPairs = useMemo<[number, number][]>(
        () => [...silentOnsets],
        [silentOnsets]
    )
    const { tickToSeconds, secondsToTick } = useTimeMapping(msm, silentOnsetPairs)
    const [committedTempos, setCommittedTempos] = useState<TempoWithEndDate[]>([])
    const [drawnLines, setDrawnLines] = useState<DrawnLine[]>(tempoData?.drawnLines ?? [])
    const [mode, setMode] = useState<SkylineMode>(undefined)

    const stretchX = usePhysicalZoom()
    const [stretchY, setStretchY] = useState(1)

    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('tempo-desk', element, 'physical');
        } else {
            unregister('tempo-desk');
        }
    }, [register, unregister]);

    const setTempoCluster = (newCluster: TempoCluster) => {
        setTempoClusterState(newCluster)
        setSecondary(prev => ({
            ...prev,
            tempo: {
                ...prev.tempo,
                tempoCluster: newCluster.segments
            }
        }))
    }

    const setSilentOnset = (date: number, onset: number) => {
        setSilentOnsetsState(prev => {
            const next = new Map(prev)
            next.set(date, onset)
            setSecondary(prevSecondary => ({
                ...prevSecondary,
                tempo: {
                    ...prevSecondary.tempo,
                    silentOnsets: [...next].map(([date, onset]) => ({ date, onset }))
                }
            }))
            return next
        })
    }

    const updateDrawnLines = (newLines: DrawnLine[]) => {
        setDrawnLines(newLines)
        setSecondary(prev => ({
            ...prev,
            tempo: {
                ...prev.tempo,
                drawnLines: newLines
            }
        }))
    }

    useEffect(() => {
        const tempos = mpm.getInstructions<Tempo>('tempo', part)
            .slice()
            .sort((a, b) => a.date - b.date)
        setCommittedTempos(tempos
            .map((tempo, i) => {
                const next = tempos[i + 1]
                const storedEndDate = (tempo as TempoWithOptionalEndDate).endDate
                const endDate = next
                    ? Math.min(next.date, storedEndDate ?? next.date)
                    : storedEndDate
                if (!endDate || endDate <= tempo.date) return null
                return { ...tempo, endDate }
            })
            .filter((t): t is TempoWithEndDate => t !== null))
    }, [mpm, part])

    useEffect(() => {
        msm.shiftToFirstOnset()

        setTempoClusterState((prev) => {
            if (prev.segments.length > 0) return prev
            return new TempoCluster(extractTempoSegments(msm, part))
        })
    }, [msm, part])

    const onsets = useMemo(() => extractOnsets(msm, part), [msm, part])
    const chartHeight = tempoCluster && tickToSeconds ? -stretchY * tempoCluster.highestBPM(tickToSeconds) : 0

    const { play, stop } = usePiano()
    const { slice } = useNotes()

    // Local preview: run InsertTempo transformers for drawn lines to produce preview tempos
    const previewTempos = useMemo<TempoWithEndDate[]>(() => {
        if (drawnLines.length === 0) return []

        const scratchMPM = new MPM()

        // First, apply all existing committed tempos to the scratch MPM
        for (const ct of committedTempos) {
            const tempo: Tempo = {
                type: 'tempo',
                'xml:id': ct['xml:id'],
                date: ct.date,
                bpm: ct.bpm,
                beatLength: ct.beatLength,
                ...(ct['transition.to'] !== undefined ? {
                    'transition.to': ct['transition.to'],
                    meanTempoAt: ct.meanTempoAt
                } : {})
            }
            scratchMPM.insertInstruction(tempo, part, true)
        }

        // Then apply drawn lines as InsertTempo transformers
        for (const line of drawnLines) {
            if (line.startTick === undefined || line.endTick === undefined) continue
            const isTransition = Math.abs(line.from.bpm - line.to.bpm) > 0.01
            const transformer = new InsertTempo({
                from: line.startTick,
                to: line.endTick,
                bpm: line.from.bpm,
                beatLength: line.beatLength,
                scope: part,
                ...(isTransition ? {
                    transitionTo: line.to.bpm,
                    meanTempoAt: line.meanTempoAt
                } : {})
            })
            transformer.run(msm, scratchMPM)
        }

        const tempos = scratchMPM.getInstructions<Tempo>('tempo', part)
            .slice()
            .sort((a, b) => a.date - b.date)

        return tempos
            .map((tempo, i) => {
                const next = tempos[i + 1]
                const endDate = next ? next.date : (tempo as TempoWithOptionalEndDate).endDate
                if (!endDate || endDate <= tempo.date) return null
                return { ...tempo, endDate }
            })
            .filter((t): t is TempoWithEndDate => t !== null)
    }, [drawnLines, committedTempos, msm, part])

    // Use preview tempos if there are drawn lines, otherwise committed tempos
    const displayTempos = drawnLines.length > 0 ? previewTempos : committedTempos

    // Group displayed tempos into chains by contiguity (prev.endDate === curr.date)
    const committedChains = useMemo<TempoWithEndDate[][]>(() => {
        if (displayTempos.length === 0) return []
        const chains: TempoWithEndDate[][] = [[displayTempos[0]]]
        for (let i = 1; i < displayTempos.length; i++) {
            const prev = displayTempos[i - 1]
            const curr = displayTempos[i]
            if (prev.endDate === curr.date) {
                chains[chains.length - 1].push(curr)
            } else {
                chains.push([curr])
            }
        }
        return chains
    }, [displayTempos])

    const buildChainMidi = useCallback((chain: TempoWithEndDate[]): MidiFile | undefined => {
        const chainStart = chain[0].date
        const chainEnd = chain[chain.length - 1].endDate
        const notes = structuredClone(slice(chainStart, chainEnd))

        let accumulatedMs = 0
        for (const seg of chain) {
            const segDurationMs = computeMillisecondsAt(seg.endDate, seg)

            for (const note of notes) {
                if (note.date >= seg.date && note.date < seg.endDate) {
                    note["midi.onset"] = (accumulatedMs + computeMillisecondsAt(note.date, seg)) / 1000
                    const noteEnd = Math.min(note.date + note.duration, seg.endDate)
                    note["midi.duration"] = (accumulatedMs + computeMillisecondsAt(noteEnd, seg)) / 1000 - note["midi.onset"]
                }
            }

            // Metronome clicks for this segment
            for (let i = seg.date; i <= seg.endDate; i += (seg.beatLength * 4 * 720) / 2) {
                notes.push({
                    date: i,
                    duration: 5,
                    'midi.pitch': i === seg.endDate ? 120 : 127,
                    'xml:id': `metronome-${i}`,
                    part: 0,
                    pitchname: 'C',
                    accidentals: 0,
                    octave: 4,
                    'midi.onset': (accumulatedMs + computeMillisecondsAt(i, seg)) / 1000,
                    'midi.duration': 0.01,
                    'midi.velocity': 80
                })
            }

            accumulatedMs += segDurationMs
        }

        notes.sort((a, b) => (a["midi.onset"] ?? 0) - (b["midi.onset"] ?? 0))
        return asMIDI(notes)
    }, [slice])

    const committedChainMidis = useMemo(
        () => committedChains.map(buildChainMidi),
        [committedChains, buildChainMidi]
    )

    // Map each tempo to its chain index for render lookup
    const tempoToChainIndex = useMemo(() => {
        const map = new Map<TempoWithEndDate, number>()
        committedChains.forEach((chain, idx) => {
            for (const t of chain) map.set(t, idx)
        })
        return map
    }, [committedChains])

    // Debounced play/stop to prevent restart when moving between segments in the same chain
    const playingChainRef = useRef<TempoWithEndDate[] | null>(null)
    const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleChainPlay = useCallback((chain: TempoWithEndDate[], midi: MidiFile | undefined) => {
        if (stopTimeoutRef.current) {
            clearTimeout(stopTimeoutRef.current)
            stopTimeoutRef.current = null
        }
        if (playingChainRef.current === chain) return
        stop()
        playingChainRef.current = chain
        if (midi) play(midi)
    }, [play, stop])

    const handleChainStop = useCallback(() => {
        if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
        stopTimeoutRef.current = setTimeout(() => {
            stop()
            playingChainRef.current = null
            stopTimeoutRef.current = null
        }, 50)
    }, [stop])

    const handleSegmentPlay = useCallback((from: number, to: number) => {
        const notes = slice(from, to)
        const midi = asMIDI(notes)
        if (midi) {
            stop()
            play(midi)
        }
    }, [slice, play, stop])

    const insertTempoValues = () => {
        if (!tempoCluster || drawnLines.length === 0) return

        for (const line of drawnLines) {
            if (line.startTick === undefined || line.endTick === undefined) continue
            const isTransition = Math.abs(line.from.bpm - line.to.bpm) > 0.01
            addTransformer(new InsertTempo({
                from: line.startTick,
                to: line.endTick,
                bpm: line.from.bpm,
                beatLength: line.beatLength,
                scope: part,
                ...(isTransition ? {
                    transitionTo: line.to.bpm,
                    meanTempoAt: line.meanTempoAt
                } : {})
            }))
        }
        updateDrawnLines([])
    }

    const translate = () => {
        addTransformer(new TranslatePhyiscalTimeToTicks({
            translatePhysicalModifiers: true
        }))
    }

    return (
        <div>
            <Stack direction='row' spacing={1}>
                {appBarRef && createPortal((
                    <>
                        <Ribbon title='Tempo'>
                            <Button
                                size='small'
                                startIcon={<Add />}
                                variant='contained'
                                onClick={insertTempoValues}
                                disabled={drawnLines.length === 0}
                            >
                                Insert
                            </Button>
                        </Ribbon>
                        <Ribbon title='Tick Time'>
                            <Button
                                variant='contained'
                                onClick={translate}
                                size='small'
                            >
                                Translate To Ticks
                            </Button>
                        </Ribbon>
                        <Ribbon title='Mode'>
                            <ToggleButton
                                value='draw'
                                size='small'
                                selected={mode === 'draw'}
                                onChange={() => setMode(prev => prev === 'draw' ? undefined : 'draw')}
                            >
                                Draw
                            </ToggleButton>
                        </Ribbon>
                        <Ribbon title='Segments'>
                            <ToggleButton
                                value='check'
                                size='small'
                                selected={mode === 'split'}
                                onChange={() => mode === 'split' ? setMode(undefined) : setMode('split')}
                            >
                                Split
                            </ToggleButton>

                            <Button
                                size='small'
                                variant='outlined'
                                startIcon={<Merge />}
                                disabled={tempoCluster.segments.filter(s => s.selected).length < 2}
                                onClick={() => {
                                    const selected = tempoCluster.segments.filter(s => s.selected)
                                    if (selected.length < 2) return
                                    const fromDate = Math.min(...selected.map(s => s.date.start))
                                    const toDate = Math.max(...selected.map(s => s.date.end))
                                    const combined = {
                                        date: { start: fromDate, end: toDate },
                                        selected: false,
                                        silent: false
                                    }
                                    tempoCluster.unselectAll()
                                    setTempoCluster(new TempoCluster([...tempoCluster.segments, combined]))
                                }}
                            >
                                Combine
                            </Button>

                        </Ribbon>
                    </>
                ), appBarRef?.current ?? document.body)}
            </Stack>

            <div style={{ position: 'relative' }}>
                <ZoomControls
                    stretchY={stretchY}
                    setStretchY={setStretchY}
                    rangeY={[1, 2]}
                />

                {tempoCluster && tickToSeconds && (
                    <svg style={{
                        position: 'absolute',
                        left: 0,
                        top: '3rem',
                        width: 40,
                        height: -chartHeight + 100,
                        pointerEvents: 'none',
                        zIndex: 1,
                    }}
                        viewBox={`-30 ${chartHeight - 50} 30 ${-chartHeight + 100}`}
                    >
                        <VerticalScale stretchY={stretchY} maxTempo={tempoCluster.highestBPM(tickToSeconds)} />
                    </svg>
                )}

                <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
                    {tempoCluster && tickToSeconds && secondsToTick && (
                        <Skyline
                            part={part}
                            tempos={tempoCluster}
                            setTempos={setTempoCluster}
                            onsets={onsets}
                            tickToSeconds={tickToSeconds}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            mode={mode}
                            committedTempos={mode !== 'draw' ? displayTempos : []}
                            silentOnsets={silentOnsets}
                            msm={msm}
                            drawnLines={drawnLines}
                            onDrawLine={(line) => updateDrawnLines([...resolveOverlaps(drawnLines, line), line])}
                            onToggleSplitMode={() => setMode(prev => prev === 'split' ? undefined : 'split')}
                            onSplit={(first, second, onset) => {
                                setSilentOnset(second.date.start, onset)
                                setTempoCluster(new TempoCluster([...tempoCluster.segments, first, second]))
                            }}
                            onPlaySegment={handleSegmentPlay}
                            onStopSegment={stop}
                            activeElements={activeElements}
                            onActivateElement={setActiveElement}
                            onPlayChain={handleChainPlay}
                            onStopChain={handleChainStop}
                            committedChains={committedChains}
                            committedChainMidis={committedChainMidis}
                            tempoToChainIndex={tempoToChainIndex}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
