import { Button, Stack, ToggleButton } from "@mui/material"
import { InsertTempoInstructions, Marker, SilentOnset, computeMillisecondsAt, getTempoAt } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Part, Tempo } from "../../../mpm-ts/lib"
import { Skyline } from "./Skyline"
import { TempoCluster, isShallowEqual, extractTempoSegments } from "./Tempo"
import { TransformerViewProps } from "../TransformerViewProps"
import { downloadAsFile } from "../utils"

export type TempoPoint = {
    date: number
    time: number
    bpm: number
}

export type TempoCurve = TempoPoint[]

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ mpm, msm, setMPM, setMSM }: TransformerViewProps) => {
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>(new TempoCluster())
    const [silentOnsets, setSilentOnsets] = useState<SilentOnset[]>([])
    const [markers, setMarkers] = useState<Marker[]>([])
    const [part,] = useState<Part>('global')
    const [curves, setCurves] = useState<TempoCurve[]>([])
    const [splitMode, setSplitMode] = useState(false)

    useEffect(() => {
        setTempoCluster(prev => {
            if (prev.length) return prev
            // make sure not to overwrite an existing tempo architecture
            prev.importSegments(extractTempoSegments(msm, part))
            return prev.clone()
        })
    }, [msm, part])

    useEffect(() => {
        const tempos = mpm.getInstructions<Tempo>('tempo', 'global')

        const curves: TempoCurve[] = []
        const step = 10
        let frameTime = 0
        for (let i = 0; i < tempos.length - 1; i++) {
            const tempo = tempos[i]
            const nextTempo = tempos[i + 1]
            if (!nextTempo) continue

            const tempoWithEndDate = {
                ...tempo,
                endDate: nextTempo.date
            }

            const points: TempoCurve = []
            for (let i = tempo.date; i < nextTempo.date; i += step) {
                points.push({
                    date: i,
                    time: frameTime + computeMillisecondsAt(i, tempoWithEndDate) / 1000,
                    bpm: getTempoAt(i, tempoWithEndDate)
                })
            }
            curves.push(points)

            frameTime += computeMillisecondsAt(tempoWithEndDate.endDate, tempoWithEndDate) / 1000
        }

        console.log(tempos)
        setCurves(curves)
    }, [mpm])

    const insertTempoValues = () => {
        if (!tempoCluster) return

        mpm.removeInstructions('tempo', 'global')
        const transformer = new InsertTempoInstructions({
            markers,
            part,
            silentOnsets
        })
        transformer.transform(msm, mpm)
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
                        downloadAsFile(tempoCluster.serialize(), 'segments.json', 'application/json')
                    }}
                >
                    Export Tempo Segments
                </Button>
            </Stack>

            <div style={{ width: '80vw', overflow: 'scroll' }}>
                {tempoCluster && (
                    <Skyline
                        tempos={tempoCluster}
                        setTempos={setTempoCluster}
                        stretchX={20}
                        stretchY={1}
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
