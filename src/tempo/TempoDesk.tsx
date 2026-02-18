import { Button, Stack, ToggleButton } from "@mui/material"
import { ApproximateLogarithmicTempo, SilentOnset, TempoSegment, TranslatePhyiscalTimeToTicks } from "mpmify/lib/transformers"
import { TempoWithEndDate } from "mpmify"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Skyline } from "./Skyline"
import { TempoCluster, extractTempoSegments, extractOnsets, TempoSegment as LocalTempoSegment } from "./Tempo"
import { VerticalScale } from "./VerticalScale"
import { ZoomControls } from "../ZoomControls"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { SyntheticLine } from "./SyntheticLine"
import { Add, Merge } from "@mui/icons-material"
import { Ribbon } from "../Ribbon"
import { createPortal } from "react-dom"
import { Tempo } from "../../../mpm-ts/lib"
import { usePhysicalZoom } from "../hooks/ZoomProvider"
import { useSelection } from "../hooks/SelectionProvider"
import { useScrollSync } from "../hooks/ScrollSyncProvider"
import { useTimeMapping } from "../hooks/useTimeMapping"

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
        setCommittedTempos(tempos
            .map((tempo, i) => {
                const next = tempos[i + 1]
                if (!next) return null
                return { ...tempo, endDate: next.date }
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

    const previewTempos = useMemo(() => {
        if (newSegments.length === 0) return []
        return ApproximateLogarithmicTempo.preview({
            segments: newSegments,
            scope: part,
            silentOnsets: [...silentOnsets].map(([date, onset]) => ({ date, onset }))
        }, msm)
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

    const insertTempoValues = () => {
        if (!tempoCluster || newSegments.length === 0) return

        addTransformer(new ApproximateLogarithmicTempo({
            segments: newSegments,
            scope: part,
            silentOnsets: [...silentOnsets].map(([date, onset]) => ({ date, onset }))
        }))
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


