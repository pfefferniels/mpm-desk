import { Button, Stack, ToggleButton } from "@mui/material"
import { ApproximateLogarithmicTempo, SilentOnset, TempoSegment, TempoWithEndDate, TranslatePhyiscalTimeToTicks } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Skyline } from "./Skyline"
import { TempoCluster, extractTempoSegments } from "./Tempo"
import { downloadAsFile } from "../utils"
import { ZoomControls } from "../ZoomControls"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { SyntheticLine } from "./SyntheticLine"

export type TempoPoint = {
    date: number
    time: number
    bpm: number
}

export type TempoCurve = TempoWithEndDate & { startMs: number }

export type TempoDeskMode = 'split' | 'curve' | undefined

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ mpm, msm, setMPM, addTransformer, part, activeTransformer }: ScopedTransformerViewProps<ApproximateLogarithmicTempo | TranslatePhyiscalTimeToTicks>) => {
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>(new TempoCluster())
    const [silentOnsets, setSilentOnsets] = useState<SilentOnset[]>([])
    const [segments, setSegments] = useState<TempoSegment[]>([])
    const [mode, setMode] = useState<'split' | 'curve' | undefined>(undefined)

    const [stretchX, setStretchX] = useState(20)
    const [stretchY, setStretchY] = useState(1)

    useEffect(() => {
        setTempoCluster(new TempoCluster(extractTempoSegments(msm, part)))
    }, [msm, part])

    useEffect(() => {
        if (!activeTransformer) return
        if (activeTransformer instanceof ApproximateLogarithmicTempo) {
            setSegments(activeTransformer.options.segments as TempoSegment[])
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
                    color='warning'
                    onClick={() => {
                        // setMarkers(tempoCluster.segments.map(segment => {
                        //     return markerFromTempo(segment)
                        // }))
                    }}
                >
                    Insert segment for every IOI
                </Button>

                <Button
                    size='small'
                    variant='outlined'
                    color='error'
                    onClick={() => {
                        mpm.removeInstructions('tempo', part)
                        setMPM(mpm.clone())
                    }}
                >
                    Remove Instruction
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
                                    beatLength
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
                                const notes = msm.allNotes.filter(n => n.date >= segment.startDate && n.date <= segment.endDate)
                                console.log('notes', notes, 'for segment', segment)
                                if (notes.length < 2) return null

                                return (
                                    <SyntheticLine
                                        key={`segment_${i}`}
                                        notes={notes}
                                        segment={segment}
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
                {segments.length}
            </div>
        </div>
    )
}


