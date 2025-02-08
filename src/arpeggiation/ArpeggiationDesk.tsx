import { ArpeggioPlacement, DatedArpeggioPlacement, InsertDynamicsGradient, InsertTemporalSpread } from "mpmify/lib/transformers"
import { ScopedTransformerViewProps } from "../DeskSwitch"
import { Chord } from "./Chord"
import { useState } from "react"
import PlacementDetails from "./PlacementDetails"
import { Button, MenuItem, Select, Stack, TextField } from "@mui/material"

export const ArpeggiationDesk = ({ msm, mpm, setMSM, setMPM, part }: ScopedTransformerViewProps) => {
    // Add this state declaration alongside your other state hooks:
    const [beatLength, setBeatLength] = useState(720);
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

    const stretch = 30;
    const height = 250;

    const bpms = []
    let prevOnset = 0;
    for (let date = 0; date < msm.lastDate(); date += beatLength) {
        const currentNotes = msm.notesAtDate(date, part).slice().sort((a, b) => a["midi.onset"] - b["midi.onset"])
        if (!currentNotes || !currentNotes.length) continue

        const placement = placements.get(date) || defaultPlacement;
        let currentOnset = currentNotes.reduce((acc, note) => acc + note["midi.onset"], 0) / currentNotes.length;
        if (placement === 'before-beat') {
            currentOnset = currentNotes[currentNotes.length - 1]["midi.onset"];
        }
        else if (placement === 'on-beat') {
            currentOnset = currentNotes[0]["midi.onset"];
        }

        let bpm = 60 / (currentOnset - prevOnset);
        if (bpms.length) {
            const multiplier = (date - bpms[bpms.length - 1].date) / beatLength;
            console.log('multiplier', multiplier)
            bpm *= multiplier;
        }

        bpms.push({
            date: date,
            onset: currentOnset,
            bpm
        })

        prevOnset = currentOnset;
    }

    const chords = []
    for (const notes of msm.asChords().values()) {
        const chordNotes = notes.slice().sort((a, b) => a["midi.onset"] - b["midi.onset"])
        if (!chordNotes.length) continue

        const date = chordNotes[0].date
        chords.push((
            <Chord
                key={`chordNotes_${chordNotes[0]["xml:id"]}`}
                notes={chordNotes}
                onClick={() => setCurrentDate(date)}
                placement={placements.get(date) || defaultPlacement}
                stretch={stretch}
                height={height}
            />
        ))
    }

    return (
        <div>
            <Stack direction='row' spacing={1} mt={2}>
                <TextField
                    size='small'
                    label="Beat Length"
                    type="number"
                    value={beatLength}
                    onChange={(e) => setBeatLength(Number(e.target.value))}
                    InputLabelProps={{ shrink: true }}
                    variant="outlined"
                />
            </Stack>

            <div style={{ width: '80vw', overflow: 'scroll' }}>
                <svg width={10000} height={height}>
                    <g>
                        {bpms.map(({ date, onset, bpm }, i, arr) => {
                            if (i + 1 >= arr.length) return null;
                            return (
                                <>
                                    <line
                                        key={`tempoLine_${date}`}
                                        x1={onset * stretch}
                                        x2={arr[i + 1].onset * stretch}
                                        y1={height - bpm}
                                        y2={height - arr[i + 1].bpm}
                                        stroke='black'
                                        strokeOpacity={0.5}
                                    />
                                    <text
                                        x={onset * stretch}
                                        y={height - bpm + 5}
                                        fill='black'
                                        fontSize={10}
                                        strokeOpacity={0.5}
                                    >
                                        {bpm.toFixed(1)}
                                    </text>
                                </>
                            );
                        })}
                    </g>
                    <g>
                        {chords}
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
