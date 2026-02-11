import { Button, Stack, ToggleButton } from "@mui/material"
import { ApproximateLogarithmicTempo, pointsWithinSegment, SilentOnset, TempoSegment, TempoWithEndDate, TranslatePhyiscalTimeToTicks } from "mpmify/lib/transformers"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Skyline } from "./Skyline"
import { TempoCluster, extractTempoSegments, extractOnsets, TempoSegment as LocalTempoSegment } from "./Tempo"
import { ZoomControls } from "../ZoomControls"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { SyntheticLine } from "./SyntheticLine"
import { Add, Clear } from "@mui/icons-material"
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

export type TempoCurve = TempoWithEndDate & { startMs: number }

export type TempoDeskMode = 'split' | 'curve' | undefined

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ msm, mpm, addTransformer, part, appBarRef, secondary, setSecondary }: ScopedTransformerViewProps<ApproximateLogarithmicTempo | TranslatePhyiscalTimeToTicks>) => {
    const { activeElements, setActiveElement } = useSelection();
    const { tickToSeconds, secondsToTick } = useTimeMapping(msm)
    const tempoData = secondary?.tempo as TempoSecondaryData | undefined

    const [tempoCluster, setTempoClusterState] = useState<TempoCluster>(() => {
        if (tempoData?.tempoCluster && tempoData.tempoCluster.length > 0) {
            return new TempoCluster(tempoData.tempoCluster)
        }
        return new TempoCluster()
    })
    const [silentOnsets, setSilentOnsetsState] = useState<SilentOnset[]>(tempoData?.silentOnsets ?? [])
    const [segments, setSegments] = useState<TempoSegment[]>([])
    const [newSegment, setNewSegment] = useState<TempoSegment>()
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
                ...(prev.tempo as TempoSecondaryData ?? {}),
                tempoCluster: newCluster.segments
            }
        }))
    }

    const setSilentOnsets = (updater: SilentOnset[] | ((prev: SilentOnset[]) => SilentOnset[])) => {
        setSilentOnsetsState(prev => {
            const newOnsets = typeof updater === 'function' ? updater(prev) : updater
            setSecondary(prevSecondary => ({
                ...prevSecondary,
                tempo: {
                    ...(prevSecondary.tempo as TempoSecondaryData ?? {}),
                    silentOnsets: newOnsets
                }
            }))
            return newOnsets
        })
    }

    useEffect(() => {
        const tempos = mpm.getInstructions<Tempo>('tempo', part)
        setSegments(tempos
            .map((tempo, i) => {
                const next = tempos[i + 1]
                if (!next) return null
                return {
                    from: tempo.date,
                    to: next.date,
                    beatLength: tempo.beatLength,
                }
            })
            .filter(segment => segment !== null) as TempoSegment[])
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

    const insertTempoValues = () => {
        if (!tempoCluster || !newSegment) return

        addTransformer(new ApproximateLogarithmicTempo({
            ...newSegment,
            scope: part,
            silentOnsets
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
                                color='error'
                                onClick={() => {
                                    setSegments([])
                                }}
                                startIcon={<Clear />}
                            >
                                Clear
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

                <div ref={scrollContainerRef} style={{ width: '100vw', overflow: 'scroll' }}>
                    {tempoCluster && tickToSeconds && secondsToTick && (
                        <Skyline
                            part={part}
                            tempos={tempoCluster}
                            setTempos={setTempoCluster}
                            onsets={onsets}
                            tickToSeconds={tickToSeconds}
                            secondsToTick={secondsToTick}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            onAddSegment={(from, to, beatLength) => {
                                console.log('onaddsegment', from, to, beatLength)
                                setNewSegment({
                                    from,
                                    to,
                                    beatLength: beatLength / 4 / 720,
                                })
                            }}
                            mode={mode}
                            onSplit={(first, second) => {
                                const splitOnset = tickToSeconds(second.date.start)
                                setSilentOnsets(prev => {
                                    const existing = prev.find(o => o.date === second.date.start)
                                    if (existing) {
                                        existing.onset = splitOnset
                                        return [...prev]
                                    }

                                    return [...prev, {
                                        date: second.date.start,
                                        onset: splitOnset
                                    }]
                                })

                                setTempoCluster(new TempoCluster([...tempoCluster.segments, first, second]))
                            }}
                        >
                            {[...segments, newSegment].map((segment, i) => {
                                if (!segment) return

                                const segmentWithPoints = pointsWithinSegment(
                                    segment,
                                    msm.notesInPart(part),
                                    silentOnsets.map(o => ({
                                        ...o,
                                        onset: o.onset
                                    }))
                                )

                                let startTime: number | undefined = msm.notesAtDate(segment.from, part)[0]?.['midi.onset']
                                if (startTime === undefined) {
                                    startTime = silentOnsets.find(o => o.date === segment.from)?.onset
                                }

                                startTime = (startTime || 0)

                                const committed = mpm.getInstructions('tempo').find(t => t.date === segment.from)

                                return (
                                    <SyntheticLine
                                        key={`segment_${i}`}
                                        points={segmentWithPoints.points}
                                        segment={segment}
                                        startTime={startTime}
                                        stretchX={stretchX}
                                        stretchY={stretchY}
                                        active={committed ? activeElements.includes(committed['xml:id']) : false}
                                        onClick={() => {
                                            if (committed) {
                                                setActiveElement(committed['xml:id'])
                                            }
                                        }}
                                        onChange={(newSegment) => {
                                            setNewSegment(newSegment)
                                        }}
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


