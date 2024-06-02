import { Button } from "@mui/material"
import { MPM, MSM } from "mpmify"
import { InsertTempoInstructions } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Part } from "../../mpm-ts/lib"
import { Skyline } from "./tempo/Skyline"
import { Marker, TempoCluster, isShallowEqual, extractTempoSegment } from "./tempo/Tempo"

interface TransformerViewProps {
    setMSM: (newMSM: MSM) => void
    msm: MSM

    setMPM: (newMPM: MPM) => void
    mpm: MPM
}

// The idea:
// http://fusehime.c.u-tokyo.ac.jp/gottschewski/doc/dissgraphics/35(S.305).JPG

export const TempoDesk = ({ mpm, msm, setMPM, setMSM }: TransformerViewProps) => {
    const [tempoCluster, setTempoCluster] = useState<TempoCluster>()
    const [markers, setMarkers] = useState<Marker[]>([])
    const [part,] = useState<Part>('global')

    useEffect(() => {
        setTempoCluster(new TempoCluster(extractTempoSegment(msm, part)))
    }, [msm, part])

    const insertTempoValues = () => {
        if (!tempoCluster) return

        const transformer = new InsertTempoInstructions({
            // breakPoints,
            beatLength: 0.25,
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

            {tempoCluster && (
                <Skyline
                    tempos={tempoCluster}
                    setTempos={setTempoCluster}
                    stretchX={0.04}
                    stretchY={1}
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
            <Button onClick={insertTempoValues}>Insert selected tempo values into MPM</Button>
        </div>
    )
}
