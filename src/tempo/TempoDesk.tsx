import { Button } from "@mui/material"
import { InsertTempoInstructions, Marker, getTempoAt } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Part, Tempo } from "../../../mpm-ts/lib"
import { Skyline } from "./Skyline"
import { TempoCluster, isShallowEqual, extractTempoSegments } from "./Tempo"
import { TransformerViewProps } from "../TransformerViewProps"

export type TempoPoint = {
    date: number
    bpm: number
}

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ mpm, msm, setMPM, setMSM }: TransformerViewProps) => {
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>(new TempoCluster())
    const [markers, setMarkers] = useState<Marker[]>([])
    const [part,] = useState<Part>('global')
    const [syntheticPoints, setSyntheticPoints] = useState<TempoPoint[]>([])

    useEffect(() => {
        setTempoCluster(prev => {
            // make sure not to overwrite an existing tempo architecture
            prev.importSegments(extractTempoSegments(msm, part))
            return prev.clone()
        })
    }, [msm, part])

    useEffect(() => {
        const tempos = mpm.getInstructions<Tempo>('tempo', 'global')

        const points = []
        const step = 10
        for (let i = 0; i < tempos.length - 1; i++) {
            const tempo = tempos[i]
            const nextTempo = tempos[i + 1]
            if (!nextTempo) continue

            const tempoWithEndDate = {
                ...tempo,
                endDate: nextTempo.date
            }

            for (let i = tempo.date; i < nextTempo.date; i += step) {
                points.push({
                    date: i,
                    bpm: getTempoAt(i, tempoWithEndDate)
                })
            }
        }

        console.log(tempos)
        setSyntheticPoints(points)
    }, [mpm])

    const insertTempoValues = () => {
        if (!tempoCluster) return

        mpm.removeInstructions('tempo', 'global')
        const transformer = new InsertTempoInstructions({
            markers,
            part
        })
        transformer.transform(msm, mpm)
        setMSM(msm.clone())
        setMPM(mpm.clone())
    }

    return (
        <div>
            <div>
                Markers:
                {markers.map((marker, i) => (
                    <span key={`marker_${i}`}>
                        {marker.date} ({marker.beatLength}) {' | '}</span>
                ))}
            </div>

            <div style={{ width: '80vw', overflow: 'scroll' }}>
                {tempoCluster && (
                    <Skyline
                        tempos={tempoCluster}
                        setTempos={setTempoCluster}
                        stretchX={13}
                        stretchY={1}
                        points={syntheticPoints}
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
                        }} />
                )}
            </div>
            <Button
                variant='contained'
                onClick={insertTempoValues}>
                Insert into MPM
            </Button>

            <Button variant='outlined'>
                Split Segment
            </Button>
        </div>
    )
}
