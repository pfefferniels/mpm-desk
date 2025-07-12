import { useEffect, useState } from "react";
import { ScopedTransformerViewProps } from "../DeskSwitch";
import { ArpeggioPlacement, InsertTemporalSpread } from "mpmify";
import { ChordSpread } from "./ChordSpread";
import { Stack, TextField, Select, MenuItem, Button, Divider, Drawer, FormControl, InputLabel, Typography } from "@mui/material";
import { ZoomControls } from "../ZoomControls";
import { Ornament, OrnamentDef, TemporalSpread } from "../../../mpm-ts/lib";

export const TemporalSpreadDesk = ({ msm, mpm, part, addTransformer }: ScopedTransformerViewProps<InsertTemporalSpread>) => {
    const [temporalSpreads, setTemporalSpreads] = useState<(Ornament & { def: TemporalSpread })[]>([])

    // these are being defined in the drawer
    const [currentDate, setCurrentDate] = useState<number>()
    const [placement, setPlacement] = useState<ArpeggioPlacement>('estimate');
    const [durationThreshold, setDurationThreshold] = useState<number>()

    // this is used for drawing the preview of a tempo curve
    const [beatLength, setBeatLength] = useState(720);
    const [stretchX, setStretchX] = useState(20)

    useEffect(() => {
        const spreads = mpm
            .getInstructions<Ornament>('ornament', part)
            .map(ornament => {
                const def = mpm.getDefinition('ornamentDef', ornament['name.ref']) as OrnamentDef
                return {
                    ...ornament,
                    def: def?.temporalSpread
                }
            })
            .filter((spread): spread is (Ornament & { def: TemporalSpread }) => spread.def !== undefined);
        setTemporalSpreads(spreads);
    }, [mpm, part])

    const transform = () => {
        if (currentDate) {
            // This is a single temporal spread
            addTransformer(new InsertTemporalSpread(), {
                scope: part,
                placement,
                noteOffShiftTolerance: 2,
                date: currentDate,
            })
        }
        else {
            // This is a default temporal spread
            addTransformer(new InsertTemporalSpread(), {
                scope: part,
                placement,
                noteOffShiftTolerance: 2,
                durationThreshold: 35
            })
        }
    }

    const height = 250;

    const bpms = []
    let prevOnset = 0;
    for (let date = 0; date < msm.lastDate(); date += beatLength) {
        const currentNotes = msm.notesAtDate(date, part).slice().sort((a, b) => a["midi.onset"] - b["midi.onset"])
        if (!currentNotes || !currentNotes.length) continue

        const currentOnset = currentNotes.reduce((acc, note) => acc + note["midi.onset"], 0) / currentNotes.length;

        let bpm = 60 / (currentOnset - prevOnset);
        if (bpms.length) {
            const multiplier = (date - bpms[bpms.length - 1].date) / beatLength;
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
        const existingSpread = temporalSpreads.find(s => s.date === date)

        chords.push((
            <ChordSpread
                key={`chordNotes_${chordNotes[0]["xml:id"]}`}
                notes={chordNotes}
                stretch={stretchX}
                height={height}
                spread={existingSpread?.def}
                onClick={() => setCurrentDate(date)}
                placement={(currentDate && (date === currentDate)) ? placement : undefined}
            />
        ))
    }

    return (
        <div>
            <Stack direction='row' spacing={1} mt={2} mb={2}>
                <TextField
                    size='small'
                    label="Beat Length"
                    type="number"
                    value={beatLength}
                    onChange={(e) => setBeatLength(Number(e.target.value))}
                    InputLabelProps={{ shrink: true }}
                    variant="outlined"
                />
                <Divider orientation="vertical" flexItem />
                <Button
                    variant='contained'
                    onClick={transform}
                >
                    Insert Temporal Spreads
                </Button>
            </Stack>

            <ZoomControls
                stretchX={stretchX}
                setStretchX={setStretchX}
                rangeX={[1, 40]}
            />

            <div style={{ width: '80vw', overflow: 'scroll' }}>
                <svg width={10000} height={height}>
                    <g>
                        {bpms.map(({ date, onset, bpm }, i, arr) => {
                            if (i + 1 >= arr.length) return null;
                            return (
                                <>
                                    <line
                                        key={`tempoLine_${date}`}
                                        x1={onset * stretchX}
                                        x2={arr[i + 1].onset * stretchX}
                                        y1={height - bpm}
                                        y2={height - arr[i + 1].bpm}
                                        stroke='black'
                                        strokeOpacity={0.5}
                                    />
                                    <text
                                        x={onset * stretchX}
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
            <Drawer
                anchor='right'
                variant='permanent'
            >
                <div style={{ width: 250, padding: 16 }}>
                    <Typography>
                        {currentDate}
                    </Typography>

                    <FormControl fullWidth>
                        <InputLabel id="placement-select-label">Placement</InputLabel>
                        <Select
                            labelId="placement-select-label"
                            id="placement-select"
                            onChange={(e) => setPlacement(e.target.value as ArpeggioPlacement)}
                            defaultValue="none"
                            value={placement}
                        >
                            <MenuItem value="on-beat">On Beat</MenuItem>
                            <MenuItem value="before-beat">Before Beat</MenuItem>
                            <MenuItem value="estimate">Estimate</MenuItem>
                            <MenuItem value="none">None (fallback to default)</MenuItem>
                        </Select>
                    </FormControl>

                    {!currentDate && (
                        <FormControl>
                            <TextField
                                label="Duration Threshold"
                                type="number"
                                value={durationThreshold}
                                onChange={(e) => setDurationThreshold(Number(e.target.value))}
                                InputLabelProps={{ shrink: true }}
                                variant="outlined"
                                fullWidth
                            />
                        </FormControl>
                    )}
                </div>
            </Drawer>
        </div>
    )
}
