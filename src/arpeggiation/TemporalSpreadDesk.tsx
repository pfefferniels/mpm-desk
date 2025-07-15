import { useEffect, useState } from "react";
import { ScopedTransformerViewProps } from "../TransformerViewProps";
import { ArpeggioPlacement, InsertTemporalSpread } from "mpmify";
import { ChordSpread } from "./ChordSpread";
import { TextField, Select, MenuItem, Button, FormControl, InputLabel, Dialog, DialogContent, DialogActions, DialogTitle, Stack } from "@mui/material";
import { Ornament, OrnamentDef, TemporalSpread } from "../../../mpm-ts/lib";
import { createPortal } from "react-dom";
import { Ribbon } from "../Ribbon";
import { usePhysicalZoom } from "../hooks/ZoomProvider";
import { Add } from "@mui/icons-material";
import { TempoVariance } from "./TempoVariance";

export const TemporalSpreadDesk = ({ msm, mpm, part, addTransformer, appBarRef }: ScopedTransformerViewProps<InsertTemporalSpread>) => {
    const [temporalSpreads, setTemporalSpreads] = useState<(Ornament & { def: TemporalSpread })[]>([])
    const [insert, setInsert] = useState(false);

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
            console.log('current date', currentDate)
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
                                        setInsert(true)
                                    }}
                                    startIcon={<Add />}
                                >
                                    Insert {!currentDate && 'Default'}
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
                        {chords}
                    </g>
                    <TempoVariance
                        msm={msm}
                        part={part}
                        beatLength={beatLength}
                    />
                </svg>
            </div>
            <Dialog
                open={insert}
                onClose={() => {
                    setCurrentDate(undefined)
                    setInsert(false)
                }}
            >
                <DialogTitle>
                    {currentDate ? `Temporal Spread @${currentDate}` : 'Insert Default'}
                </DialogTitle>
                <DialogContent>
                    <Stack direction="row" spacing={2} alignItems="center" m={2}>
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
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        transform();
                        setCurrentDate(undefined);
                        setInsert(false)
                    }}>
                        Insert
                    </Button>
                </DialogActions>
            </Dialog>
        </div >
    )
}
