import { Button, Stack, ToggleButton } from "@mui/material"
import { ApproximateLogarithmicTempo, SilentOnset, TempoSegment, TranslatePhyiscalTimeToTicks } from "mpmify/lib/transformers"
import { computeMillisecondsAt, TempoWithEndDate } from "mpmify"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Skyline } from "./Skyline"
import { TempoCluster, extractTempoSegments, extractOnsets, TempoSegment as LocalTempoSegment } from "./Tempo"
import { VerticalScale } from "./VerticalScale"
import { ZoomControls } from "../../components/ZoomControls"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { SyntheticLine } from "./SyntheticLine"
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

type TempoWithOptionalEndDate = Tempo & { endDate?: number }

export type TempoSecondaryData = {
    tempoCluster?: LocalTempoSegment[]
    silentOnsets?: SilentOnset[]
}

export type TempoPoint = {
    date: number
    time: number
    bpm: number
}

export type TempoDeskMode = 'split' | 'curve' | undefined

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ msm, mpm, addTransformer, part, appBarRef, secondary, setSecondary }: ScopedTransformerViewProps<ApproximateLogarithmicTempo | TranslatePhyiscalTimeToTicks>) => {
    const { activeElements, setActiveElement } = useSelection();
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
    const [newSegments, setNewSegments] = useState<TempoSegment[]>([])
    const [mode, setMode] = useState<'split' | 'curve' | undefined>(undefined)

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

    // Re-derive is automatic: tickToSeconds recomputes when msm changes

    const onsets = useMemo(() => extractOnsets(msm, part), [msm, part])
    const chartHeight = tempoCluster && tickToSeconds ? -stretchY * tempoCluster.highestBPM(tickToSeconds) : 0

    const { play, stop } = usePiano()
    const { slice } = useNotes()

    // Group committed tempos into chains by contiguity (prev.endDate === curr.date)
    const committedChains = useMemo<TempoWithEndDate[][]>(() => {
        if (committedTempos.length === 0) return []
        const chains: TempoWithEndDate[][] = [[committedTempos[0]]]
        for (let i = 1; i < committedTempos.length; i++) {
            const prev = committedTempos[i - 1]
            const curr = committedTempos[i]
            if (prev.endDate === curr.date) {
                chains[chains.length - 1].push(curr)
            } else {
                chains.push([curr])
            }
        }
        return chains
    }, [committedTempos])

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

    const previewTempos = useMemo(() => {
        if (newSegments.length === 0) return []

        const silentOnsetArray = [...silentOnsets].map(([date, onset]) => ({ date, onset }))

        if (newSegments.length === 1) {
            return ApproximateLogarithmicTempo.preview({
                ...newSegments[0],
                scope: part,
                silentOnsets: silentOnsetArray
            }, msm)
        }

        // Simulate the pipeline: each segment's preview feeds into a scratch MPM
        // so the next segment's reconstructChain finds the prior chain.
        const scratchMPM = new MPM()
        let result: TempoWithEndDate[] = []

        for (let i = 0; i < newSegments.length; i++) {
            result = ApproximateLogarithmicTempo.preview({
                ...newSegments[i],
                scope: part,
                silentOnsets: silentOnsetArray,
                continue: i > 0
            }, msm, i > 0 ? scratchMPM : undefined)

            // Replace scratch MPM tempo instructions for next iteration
            for (const t of scratchMPM.getInstructions<Tempo>('tempo', part)) {
                scratchMPM.removeInstruction(t)
            }
            for (const t of result) {
                scratchMPM.insertInstruction(t, part, true)
            }
        }

        return result
    }, [newSegments, part, silentOnsets, msm])

    const chainEndpoint = useMemo(() => {
        if (previewTempos.length === 0 || newSegments.length === 0) return undefined
        const last = previewTempos[previewTempos.length - 1]
        const lastSeg = newSegments[newSegments.length - 1]
        return {
            date: last.endDate,
            beatLength: lastSeg.beatLength * 4 * 720,
            bpm: last['transition.to'] || last.bpm
        }
    }, [previewTempos, newSegments])

    const previewChainMidi = useMemo(
        () => previewTempos.length > 0 ? buildChainMidi(previewTempos) : undefined,
        [previewTempos, buildChainMidi]
    )

    const insertTempoValues = () => {
        if (!tempoCluster || newSegments.length === 0) return

        for (let i = 0; i < newSegments.length; i++) {
            addTransformer(new ApproximateLogarithmicTempo({
                ...newSegments[i],
                scope: part,
                silentOnsets: [...silentOnsets].map(([date, onset]) => ({ date, onset })),
                continue: i > 0
            }))
        }
        setNewSegments([])
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
                            onAddSegment={(from, to, beatLength) => {
                                setNewSegments([{
                                    from,
                                    to,
                                    beatLength: beatLength / 4 / 720,
                                }])
                            }}
                            chainEndpoint={chainEndpoint}
                            onChainSegment={(from, to, beatLength) => {
                                setNewSegments(prev => [...prev, {
                                    from,
                                    to,
                                    beatLength: beatLength / 4 / 720,
                                }])
                            }}
                            mode={mode}
                            onToggleSplitMode={() => setMode(prev => prev === 'split' ? undefined : 'split')}
                            onSplit={(first, second, onset) => {
                                setSilentOnset(second.date.start, onset)

                                setTempoCluster(new TempoCluster([...tempoCluster.segments, first, second]))
                            }}
                        >
                            {committedTempos.map((t, i) => {
                                let startTime: number | undefined = msm.notesAtDate(t.date, part)[0]?.['midi.onset']
                                if (startTime === undefined) {
                                    startTime = silentOnsets.get(t.date)
                                }

                                const chainIndex = tempoToChainIndex.get(t)!
                                const chain = committedChains[chainIndex]

                                return (
                                    <SyntheticLine
                                        key={`committed_${i}`}
                                        tempo={t}
                                        startTime={startTime || 0}
                                        stretchX={stretchX}
                                        stretchY={stretchY}
                                        chartHeight={chartHeight}
                                        active={activeElements.includes(t['xml:id'])}
                                        onClick={() => setActiveElement(t['xml:id'])}
                                        onPlay={() => handleChainPlay(chain, committedChainMidis[chainIndex])}
                                        onStop={handleChainStop}
                                    />
                                )
                            })}

                            {previewTempos.map((previewTempo, i) => {
                                let startTime: number | undefined = msm.notesAtDate(previewTempo.date, part)[0]?.['midi.onset']
                                if (startTime === undefined) {
                                    startTime = silentOnsets.get(previewTempo.date)
                                }

                                return (
                                    <SyntheticLine
                                        key={`preview_${i}`}
                                        tempo={previewTempo}
                                        startTime={startTime || 0}
                                        stretchX={stretchX}
                                        stretchY={stretchY}
                                        chartHeight={chartHeight}
                                        active={false}
                                        onClick={() => {}}
                                        onPlay={() => handleChainPlay(previewTempos, previewChainMidi)}
                                        onStop={handleChainStop}
                                    />
                                )
                            })}
                        </Skyline>
                    )}
                </div>
            </div>
        </div>
    )
}

