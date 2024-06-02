import { Button } from "@mui/material"
import { MPM, MSM } from "mpmify"
import { InsertTempoInstructions } from "mpmify/lib/transformers"
import { useEffect, useState } from "react"
import { Part } from "../../mpm-ts/lib"
import { Skyline } from "./tempo/Skyline"
import { Marker, Tempo, TempoCluster, isShallowEqual } from "./tempo/Tempo"

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
        const newPoints: Tempo[] = []
        const chords = Object.entries(msm.asChords(part))
        for (let i = 0; i < chords.length - 1; i++) {
            console.log('adding')
            const [date, notes] = chords[i]
            const [nextDate, nextNotes] = chords[i + 1]

            const onset = notes[0]['midi.onset']
            const nextOnset = nextNotes[0]['midi.onset']
            if (!onset || !nextOnset) {
                console.log('MIDI onset not defined')
                continue
            }

            newPoints.push({
                date: {
                    start: +date,
                    end: +nextDate
                },
                time: {
                    start: onset,
                    end: nextOnset
                },
                selected: false
            })
        }

        console.log('poitns=', chords)
        setTempoCluster(new TempoCluster(newPoints))
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
