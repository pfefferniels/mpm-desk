import { Button, Stack, ToggleButton } from "@mui/material"
import { CompressTempo, InsertTempoInstructions, Marker, SilentOnset, TranslatePhyiscalTimeToTicks, computeMillisecondsAt, getTempoAt } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Tempo } from "../../../mpm-ts/lib"
import { Skyline } from "./Skyline"
import { TempoCluster, isShallowEqual, extractTempoSegments } from "./Tempo"
import { downloadAsFile } from "../utils"
import { ZoomControls } from "./ZoomControls"
import { ScopedTransformerViewProps } from "../DeskSwitch"

export type TempoPoint = {
    date: number
    time: number
    bpm: number
}

export type TempoCurve = TempoPoint[]

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ mpm, msm, setMPM, setMSM, part }: ScopedTransformerViewProps) => {
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>(new TempoCluster())
    const [silentOnsets, setSilentOnsets] = useState<SilentOnset[]>([])
    const [markers, setMarkers] = useState<Marker[]>([])
    const [curves, setCurves] = useState<TempoCurve[]>([])
    const [splitMode, setSplitMode] = useState(false)
    const [stretchX, setStretchX] = useState(20)
    const [stretchY, setStretchY] = useState(1)

    useEffect(() => {
        if (markers.length === 0) {
            // TODO: make sure not to overwrite an existing tempo architecture
            setTempoCluster(new TempoCluster(extractTempoSegments(msm, part)))
        }
    }, [msm, part, markers])

    useEffect(() => {
        const tempos = mpm.getInstructions<Tempo>('tempo', part)

        const curves: TempoCurve[] = []
        const step = 10
        let frameTime = 0
        for (let i = 0; i < tempos.length; i++) {
            const tempo = tempos[i]

            let endDate

            const nextTempo = tempos[i + 1]
            if (nextTempo) {
                endDate = nextTempo.date
            }
            else {
                endDate = Math.max(...msm.allNotes.map(n => n.date))
            }

            const tempoWithEndDate = {
                ...tempo,
                endDate
            }

            const points: TempoCurve = []
            for (let i = tempo.date; i < endDate; i += step) {
                points.push({
                    date: i,
                    time: frameTime + computeMillisecondsAt(i, tempoWithEndDate) / 1000,
                    bpm: getTempoAt(i, tempoWithEndDate)
                })
            }
            curves.push(points)

            frameTime += computeMillisecondsAt(endDate, tempoWithEndDate) / 1000
        }

        console.log(tempos)
        setCurves(curves)
    }, [mpm, part, msm])

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
            setMarkers(json.markers)
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

        mpm.removeInstructions('tempo', part)
        const insert = new InsertTempoInstructions({
            markers,
            part,
            silentOnsets
        })
        const compress = new CompressTempo()

        const translate = new TranslatePhyiscalTimeToTicks({
            'translatePhysicalModifiers': true
        })

        insert.transform(msm, mpm)
        compress.transform(msm, mpm)
        translate.transform(msm, mpm)

        insert.insertMetadata(mpm)
        compress.insertMetadata(mpm)
        translate.insertMetadata(mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }

    return (
        <div>
            <Stack direction='row' spacing={1}>
                <Button
                    variant='contained'
                    onClick={insertTempoValues}
                >
                    Save to MPM
                </Button>

                <Button
                    variant='outlined'
                    onClick={() => {
                        const json = {
                            tempoCluster: tempoCluster.segments,
                            markers,
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
            </Stack>

            <div style={{ position: 'relative' }}>
                <ZoomControls setStretchX={setStretchX} setStretchY={setStretchY} />
                <div style={{ width: '80vw', overflow: 'scroll' }}>
                    {tempoCluster && (
                        <Skyline
                            part={part}
                            tempos={tempoCluster}
                            setTempos={setTempoCluster}
                            stretchX={stretchX}
                            stretchY={stretchY}
                            curves={curves}
                            markers={markers}
                            onMark={newMarker => {
                                setMarkers([...markers, newMarker])
                            }}
                            onRemoveMarker={toRemove => {
                                setMarkers(prev => {
                                    const index = markers.findIndex(marker => isShallowEqual(marker, toRemove))
                                    if (index === -1) return prev

                                    prev.splice(index, 1)
                                    return [...prev]
                                })
                            }}
                            splitMode={splitMode}
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
                        />
                    )}
                </div>
            </div>

            <div>
                <ToggleButton
                    value='check'
                    size='small'
                    selected={splitMode}
                    onChange={() => setSplitMode(!splitMode)}
                >
                    Split Segment
                </ToggleButton>
            </div>
        </div>
    )
}
