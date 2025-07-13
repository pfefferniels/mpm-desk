import { useEffect, useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { ArpeggioPlacement, InsertTemporalSpread } from "mpmify";
import { ChordSpread } from "./ChordSpread";
import { TextField, Select, MenuItem, Button, FormControl, InputLabel, Typography, Dialog, DialogContent, DialogActions } from "@mui/material";
import { Ornament, OrnamentDef, TemporalSpread } from "../../../mpm-ts/lib";
import { createPortal } from "react-dom";
import { Ribbon } from "../Ribbon";
import { usePhysicalZoom } from "../hooks/ZoomProvider";

export const TemporalSpreadDesk = ({ msm, mpm, part, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertTemporalSpread>) => {
    const [temporalSpreads, setTemporalSpreads] = useState<(Ornament & { def: TemporalSpread })[]>([])
    const [insertDefault, setInsertDefault] = useState(false);

    // these are being defined in the drawer
    const [currentDate, setCurrentDate] = useState<number>()
    const [placement, setPlacement] = useState<ArpeggioPlacement>('estimate');
    const [durationThreshold, setDurationThreshold] = useState<number>()

    // this is used for drawing the preview of a tempo curve
    const [beatLength, setBeatLength] = useState(720);

    const stretchX = usePhysicalZoom()

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
            addTransformer(new InsertTemporalSpread({
                scope: part,
                placement,
                noteOffShiftTolerance: 2,
                date: currentDate,
            }))
        }
        else {
            // This is a default temporal spread
            addTransformer(new InsertTemporalSpread({
                scope: part,
                placement,
                noteOffShiftTolerance: 2,
                durationThreshold: 35
            }))
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
            {appBarRef && (
                <>
                    {createPortal((
                        <>
                            <Ribbon title="Temporal Spread">
                                <Button
                                    size='small'
                                    variant='outlined'
                                    onClick={() => {
                                        setInsertDefault(true)
                                    }}
                                >
                                    Insert Default
                                </Button>
                            </Ribbon>
                            <Ribbon title='Tempo Curve'>
                                <TextField
                                    size='small'
                                    label="Beat Length"
                                    type="number"
                                    value={beatLength}
                                    onChange={(e) => setBeatLength(Number(e.target.value))}
                                    InputLabelProps={{ shrink: true }}
                                    variant="outlined"
                                    sx={{ width: '100px' }}
                                />
                            </Ribbon>
                        </>
                    ), appBarRef.current || document.body)}
                </>
            )}

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
            <Dialog
                open={currentDate !== undefined || insertDefault}
                onClose={() => {
                    setCurrentDate(undefined)
                    setInsertDefault(false)
                }}
            >
                <DialogContent>
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
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        transform();
                        setCurrentDate(undefined);
                    }}>
                        Insert
                    </Button>
                </DialogActions>
            </Dialog>
        </div >
    )
}
