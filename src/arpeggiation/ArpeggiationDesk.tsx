import { ArpeggioPlacement, DatedArpeggioPlacement, InsertDynamicsGradient, InsertTemporalSpread } from "mpmify/lib/transformers"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Chord } from "./Chord"
import { useState } from "react"
import PlacementDetails from "./PlacementDetails"
import { Button, MenuItem, Select, Stack } from "@mui/material"

export const ArpeggiationDesk = ({ msm, mpm, setMSM, setMPM, part }: ScopedTransformerViewProps) => {
    const [currentDate, setCurrentDate] = useState<number>()
    const [placements, setPlacement] = useState<DatedArpeggioPlacement>(new Map())
    const [defaultPlacement, setDefaultPlacement] = useState<ArpeggioPlacement>('estimate')

    const transform = () => {
        const insertGradient = new InsertDynamicsGradient({
            part
        })

        const insertSpread = new InsertTemporalSpread({
            minimumArpeggioSize: 2,
            durationThreshold: 2,
            part,
            placement: placements,
            defaultPlacement,
            noteOffShiftTolerance: 2
        })

        insertGradient.transform(msm, mpm)
        insertSpread.transform(msm, mpm)

        insertGradient.insertMetadata(mpm)
        insertSpread.insertMetadata(mpm)

        setMSM(msm.clone())
        setMPM(mpm.clone())
    }

    const c = []
    for (const notes of msm.asChords().values()) {
        const chordNotes = notes.slice().sort((a, b) => a["midi.onset"] - b["midi.onset"])
        const date = chordNotes[0].date
        c.push((
            <Chord
                key={`chordNotes_${chordNotes[0]["xml:id"]}`}
                notes={chordNotes}
                onClick={() => setCurrentDate(date)}
                placement={placements.get(date) || defaultPlacement}
            />
        ))
    }

    return (
        <div>
            <div style={{ width: '80vw', overflow: 'scroll' }}>
                <svg width={10000}>
                    <g>
                        {c}
                    </g>
                </svg>
            </div>

            <Stack direction='column' spacing={1} sx={{ width: '10%' }}>
                <Select
                    value={defaultPlacement}
                    onChange={(e) => setDefaultPlacement(e.target.value as ArpeggioPlacement)}
                >
                    <MenuItem value="before-beat">All before beat</MenuItem>
                    <MenuItem value="on-beat">All on beat</MenuItem>
                    <MenuItem value="estimate">Estimate</MenuItem>
                </Select>

                <Button
                    variant='contained'
                    onClick={transform}
                >
                    Transform
                </Button>
            </Stack>

            <PlacementDetails
                setPlacement={(placement) => {
                    if (!currentDate) return
                    placements.set(currentDate, placement)
                    setPlacement(new Map(placements))
                }}
                placement={placements.get(currentDate || -1) || 'none'}
                open={!!currentDate}
                onClose={() => setCurrentDate(undefined)}
            />
        </div>
    )
}
