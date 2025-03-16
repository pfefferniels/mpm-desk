import { Button, Stack, ToggleButton } from "@mui/material"
import { ApproximateLogarithmicTempo, pointsWithinSegment, SilentOnset, TempoSegment, TempoWithEndDate, TranslatePhyiscalTimeToTicks } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Skyline } from "./Skyline"
import { TempoCluster, extractTempoSegments } from "./Tempo"
import { downloadAsFile } from "../utils/utils"
import { ZoomControls } from "../ZoomControls"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { SyntheticLine } from "./SyntheticLine"
import { Clear } from "@mui/icons-material"

export type TempoPoint = {
    date: number
    time: number
    bpm: number
}

export type TempoCurve = TempoWithEndDate & { startMs: number }

export type TempoDeskMode = 'split' | 'curve' | undefined

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ msm, addTransformer, part, activeTransformer }: ScopedTransformerViewProps<ApproximateLogarithmicTempo | TranslatePhyiscalTimeToTicks>) => {
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>(new TempoCluster())
    const [silentOnsets, setSilentOnsets] = useState<SilentOnset[]>([])
    const [segments, setSegments] = useState<TempoSegment[]>([])
    const [mode, setMode] = useState<'split' | 'curve' | undefined>(undefined)

    const [stretchX, setStretchX] = useState(20)
    const [stretchY, setStretchY] = useState(1)

    useEffect(() => {
        msm.shiftToFirstOnset()

        setTempoCluster((prev) => {
            if (prev.segments.length > 0) return prev
            return new TempoCluster(extractTempoSegments(msm, part))
        })
    }, [msm, part])

    useEffect(() => {
        if (!activeTransformer) return
        if (activeTransformer instanceof ApproximateLogarithmicTempo) {
            setSegments(activeTransformer.options.segments as TempoSegment[])
            setSilentOnsets(activeTransformer.options.silentOnsets as SilentOnset[])
        }
    }, [activeTransformer])

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return
        const reader = new FileReader();
        reader.onload = async (e: ProgressEvent<FileReader>) => {
            const content = e.target?.result as string;
            // setMSM(await asMSM(content));
            const json = JSON.parse(content)
            if (!json.tempoCluster || !json.markers || !json.silentOnsets ||
                !Array.isArray(json.tempoCluster) || !Array.isArray(json.markers) || !Array.isArray(json.silentOnsets)
            ) {
                console.log('Invalid JSON file provided.')
                return
            }

            setTempoCluster(
                new TempoCluster(json.tempoCluster)
            )
            // setMarkers(json.markers)
            setSilentOnsets(json.silentOnsets)
        };

        reader.readAsText(file);
    };

    const handleFileImport = () => {
        const fileInput = document.getElementById('segmentInput') as HTMLInputElement;
        fileInput.click();
    };

    const insertTempoValues = () => {
        if (!tempoCluster) return

        addTransformer(activeTransformer instanceof ApproximateLogarithmicTempo ? activeTransformer : new ApproximateLogarithmicTempo(), {
            segments,
            part,
            silentOnsets
        })

        // addTransformer(activeTransformer instanceof CompressTempo ? activeTransformer : new CompressTempo(), {
        //     bpmPrecision: 4,
        //     meanTempoAtPrecision: 4
        // })
    }

    const translate = () => {
        addTransformer(activeTransformer instanceof TranslatePhyiscalTimeToTicks ? activeTransformer : new TranslatePhyiscalTimeToTicks(), {
            translatePhysicalModifiers: true
        })
    }

    return (
        <div>
            <Stack direction='row' spacing={1}>
                <Button
                    variant='contained'
                    onClick={insertTempoValues}
                >
                    {activeTransformer instanceof ApproximateLogarithmicTempo ? 'Update' : 'Insert'} Tempo Instructions
                </Button>

                <Button
                    variant='contained'
                    onClick={translate}
                >
                    Translate To Ticks
                </Button>

                <Button
                    variant='outlined'
                    onClick={() => {
                        const json = {
                            tempoCluster: tempoCluster.segments,
                            silentOnsets
                        }

                        downloadAsFile(
                            JSON.stringify(json, null, 4),
                            'segments.json',
                            'application/json'
                        )
                    }}
                >
                    Export Segments
                </Button>
                <Button
                    variant='outlined'
                    onClick={handleFileImport}>
                    Import Segments
                </Button>
                <input
                    type="file"
                    id="segmentInput"
                    accept='*.json'
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />

                <Button
                    size='small'
                    variant='outlined'
                    color='error'
                    onClick={() => {
                        setSegments([])
                    }}
                    startIcon={<Clear />}
                >
                    Clear Segments
                </Button>
            </Stack>

            <div style={{ position: 'relative' }}>
                <ZoomControls
                    stretchX={stretchX}
                    setStretchX={setStretchX}
                    rangeX={[5, 50]}
                    stretchY={stretchY}
                    setStretchY={setStretchY}
                    rangeY={[1, 2]}
                />

                <div style={{ width: '80vw', overflow: 'scroll' }}>
                    {tempoCluster && (
                        <Skyline
                            part={part}
                            tempos={tempoCluster}
                            setTempos={setTempoCluster}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            onAddSegment={(from, to, beatLength) => {
                                setSegments(prev => [...prev, {
                                    startDate: from,
                                    endDate: to,
                                    beatLength: beatLength / 4 / 720,
                                }])
                            }}
                            mode={mode}
                            onSplit={(first, second) => {
                                setSilentOnsets(prev => {
                                    const existing = prev.find(o => o.date === second.date.start)
                                    if (existing) {
                                        existing.onset = second.time.start
                                        return [...prev]
                                    }

                                    return [...prev, {
                                        date: second.date.start,
                                        onset: second.time.start
                                    }]
                                })

                                // tempoCluster.importSegments([first, second])
                                setTempoCluster(new TempoCluster([...tempoCluster.segments, first, second]))
                            }}
                        >
                            {segments.map((segment, i) => {
                                console.log('silent onsets', silentOnsets)
                                // const firstOnset = msm.notesAtDate(0, part)[0]?.['midi.onset'] || 0

                                const segmentWithPoints = pointsWithinSegment(
                                    segment,
                                    msm.notesInPart(part),
                                    silentOnsets.map(o => ({
                                        ...o,
                                        onset: o.onset
                                    }))
                                )

                                let startTime: number | undefined = msm.notesAtDate(segment.startDate, part)[0]?.['midi.onset']
                                if (startTime === undefined) {
                                    startTime = silentOnsets.find(o => o.date === segment.startDate)?.onset
                                }

                                startTime = (startTime || 0)

                                return (
                                    <SyntheticLine
                                        key={`segment_${i}`}
                                        points={segmentWithPoints.points}
                                        segment={segment}
                                        startTime={startTime}
                                        stretchX={stretchX}
                                        stretchY={stretchY}
                                        onClick={(e) => {
                                            if (e.altKey && e.shiftKey) {
                                                setSegments(prev => prev.filter(s => s !== segment))
                                                return
                                            }
                                        }}
                                        onChange={(newSegment) => {
                                            setSegments(prev => prev.map(s => s === segment ? newSegment : s))
                                        }}
                                    />
                                )
                            })}
                        </Skyline>
                    )}
                </div>
            </div>

            <div>
                <ToggleButton
                    value='check'
                    size='small'
                    selected={mode === 'split'}
                    onChange={() => mode === 'split' ? setMode(undefined) : setMode('split')}
                >
                    Split Segment
                </ToggleButton>
            </div>
        </div>
    )
}


