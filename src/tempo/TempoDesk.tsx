import { Button, Stack, ToggleButton } from "@mui/material"
import { CompressTempo, InsertTempoInstructions, Marker, SilentOnset, TempoWithEndDate, TranslatePhyiscalTimeToTicks, computeMillisecondsAt } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Tempo } from "../../../mpm-ts/lib"
import { Skyline } from "./Skyline"
import { TempoCluster, extractTempoSegments, markerFromTempo } from "./Tempo"
import { downloadAsFile } from "../utils"
import { ZoomControls } from "../ZoomControls"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { MarkerDrawer } from "./MarkerDrawer"

export type TempoPoint = {
    date: number
    time: number
    bpm: number
}

export type TempoCurve = TempoWithEndDate & { startMs: number }

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ mpm, msm, setMPM, setMSM, addTransformer, part }: ScopedTransformerViewProps) => {
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>(new TempoCluster())
    const [silentOnsets, setSilentOnsets] = useState<SilentOnset[]>([])
    const [markers, setMarkers] = useState<Marker[]>([])
    const [curves, setCurves] = useState<TempoCurve[]>([])
    const [splitMode, setSplitMode] = useState(false)
    const [stretchX, setStretchX] = useState(20)
    const [stretchY, setStretchY] = useState(1)

    const [activeMarker, setActiveMarker] = useState<number | null>(null)

    useEffect(() => {
        if (markers.length === 0) {
            // TODO: make sure not to overwrite an existing tempo architecture
            setTempoCluster(new TempoCluster(extractTempoSegments(msm, part)))
        }
    }, [msm, part, markers])

    useEffect(() => {
        const tempos = mpm.getInstructions<Tempo>('tempo', part)

        const curves = []
        let startMs = 0
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

            const tempoWithEndDate: TempoCurve = {
                ...tempo,
                endDate,
                startMs
            }

            curves.push(tempoWithEndDate)
            startMs += computeMillisecondsAt(endDate, tempoWithEndDate)
        }

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
        compress.setOptions({
            bpmPrecision: 4,
            meanTempoAtPrecision: 4
        })

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

        addTransformer(insert)
        addTransformer(compress)
        addTransformer(translate)
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

                <Button
                    size='small'
                    variant='outlined'
                    color='warning'
                    onClick={() => {
                        setMarkers(tempoCluster.segments.map(segment => {
                            return markerFromTempo(segment)
                        }))
                    }}
                >
                    Insert marker for every IOI
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
                            curves={curves}
                            markers={markers}
                            onMark={newMarker => {
                                setMarkers([...markers, newMarker])
                            }}
                            onSelectMark={toSelect => {
                                setActiveMarker(toSelect.date)
                            }}
                            onRemoveMarker={toRemove => {
                                setMarkers(prev => {
                                    // there can be only one marker per date, 
                                    // so this should be safe.
                                    const index = markers.findIndex(marker => marker.date === toRemove.date)
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

            {activeMarker && (
                <MarkerDrawer
                    marker={markers.find(marker => marker.date === activeMarker)!}
                    onClose={() => setActiveMarker(null)}
                    onChange={(marker) => {
                        setMarkers(prev => {
                            const index = prev.findIndex(m => m.date === marker.date)
                            prev[index] = marker
                            return [...prev]
                        })
                    }}
                />
            )}
        </div >
    )
}


