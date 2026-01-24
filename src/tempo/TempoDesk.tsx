import { Button, Stack, ToggleButton } from "@mui/material"
import { ApproximateLogarithmicTempo, pointsWithinSegment, SilentOnset, TempoSegment, TempoWithEndDate, TranslatePhyiscalTimeToTicks } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Skyline } from "./Skyline"
import { TempoCluster, extractTempoSegments } from "./Tempo"
import { downloadAsFile } from "../utils/utils"
import { ZoomControls } from "../ZoomControls"
import { ScopedTransformerViewProps } from "../TransformerViewProps"
import { SyntheticLine } from "./SyntheticLine"
import { Add, Clear, Save, UploadFile } from "@mui/icons-material"
import { Ribbon } from "../Ribbon"
import { createPortal } from "react-dom"
import { Tempo } from "../../../mpm-ts/lib"
import { usePhysicalZoom } from "../hooks/ZoomProvider"
import { useSelection } from "../hooks/SelectionProvider"

export type TempoPoint = {
    date: number
    time: number
    bpm: number
}

export type TempoCurve = TempoWithEndDate & { startMs: number }

export type TempoDeskMode = 'split' | 'curve' | undefined

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ msm, mpm, addTransformer, part, appBarRef }: ScopedTransformerViewProps<ApproximateLogarithmicTempo | TranslatePhyiscalTimeToTicks>) => {
    const { setActiveElement } = useSelection();
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>(new TempoCluster())
    const [silentOnsets, setSilentOnsets] = useState<SilentOnset[]>([])
    const [segments, setSegments] = useState<TempoSegment[]>([])
    const [newSegment, setNewSegment] = useState<TempoSegment>()
    const [mode, setMode] = useState<'split' | 'curve' | undefined>(undefined)

    const stretchX = usePhysicalZoom()
    const [stretchY, setStretchY] = useState(1)

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

        setTempoCluster((prev) => {
            if (prev.segments.length > 0) return prev
            return new TempoCluster(extractTempoSegments(msm, part))
        })
    }, [msm, part])

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
                {createPortal((
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
                                startIcon={<Save />}
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
                                Export
                            </Button>
                            <Button
                                variant='outlined'
                                onClick={handleFileImport}
                                size='small'
                                startIcon={<UploadFile />}
                            >
                                Import
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
                                Clear
                            </Button>
                        </Ribbon>
                    </>
                ), appBarRef.current || document.body)}
            </Stack>

            <div style={{ position: 'relative' }}>
                <ZoomControls
                    stretchY={stretchY}
                    setStretchY={setStretchY}
                    rangeY={[1, 2]}
                />

                <div style={{ width: '100vw', overflow: 'scroll' }}>
                    {tempoCluster && (
                        <Skyline
                            part={part}
                            tempos={tempoCluster}
                            setTempos={setTempoCluster}
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

                                return (
                                    <SyntheticLine
                                        key={`segment_${i}`}
                                        points={segmentWithPoints.points}
                                        segment={segment}
                                        startTime={startTime}
                                        stretchX={stretchX}
                                        stretchY={stretchY}
                                        onClick={() => {
                                            // if (e.altKey && e.shiftKey) {
                                            //     setSegments(prev => prev.filter(s => s !== segment))
                                            //     return
                                            // }
                                            const commited = mpm.getInstructions('tempo').find(t => t.date === segment.from)
                                            if (commited) {
                                                setActiveElement(commited['xml:id'])
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


