import { Add } from "@mui/icons-material";
import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Slider,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography
} from "@mui/material"
import { InsertMetricalAccentuationOptions } from "mpmify";
import { useState, useEffect } from "react";

interface AccentuationDialogProps {
    open: boolean
    onClose: () => void
    cell: Omit<InsertMetricalAccentuationOptions, 'scope'>
    scaleTolerance: number
    onDone: (cell: Omit<InsertMetricalAccentuationOptions, 'scope'>, scaleTolerance: number) => void
}

const bravuraStyle = { fontFamily: "'Bravura Text'", fontSize: '1.8rem', lineHeight: 1 }

const beatLengthOptions = [
    { value: 0.5, glyph: '\uE1D3', title: 'Half Note' },
    { value: 0.25, glyph: '\uE1D5', title: 'Quarter Note' },
    { value: 0.125, glyph: '\uE1D7', title: 'Eighth Note' },
    { value: 0.0625, glyph: '\uE1D9', title: 'Sixteenth Note' },
]

const toleranceMarks = Array.from({ length: 21 }, (_, i) => ({
    value: i * 0.25,
    label: i % 4 === 0 ? `${i * 0.25}` : undefined,
}))

export const AccentuationDialog = ({ open, onClose, cell, scaleTolerance: initialScaleTolerance, onDone }: AccentuationDialogProps) => {
    const [beatLength, setBeatLength] = useState(cell.beatLength);
    const [name, setName] = useState(cell.name ?? "");
    const [neutralEnd, setNeutralEnd] = useState(cell.neutralEnd || false);
    const [scaleTolerance, setScaleTolerance] = useState(initialScaleTolerance);

    useEffect(() => {
        setBeatLength(cell.beatLength);
        setName(cell.name ?? "");
        setNeutralEnd(cell.neutralEnd || false);
        setScaleTolerance(initialScaleTolerance);
    }, [cell, initialScaleTolerance]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Insert Accentuation Pattern ({cell.from}–{cell.to})</DialogTitle>
            <DialogContent>
                <Stack direction='column' spacing={3} sx={{ mt: 1 }}>
                    <TextField
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        fullWidth
                    />

                    <div>
                        <Typography gutterBottom>Beat Length</Typography>
                        <ToggleButtonGroup
                            value={beatLength}
                            exclusive
                            onChange={(_, value) => {
                                if (value !== null) setBeatLength(value)
                            }}
                        >
                            {beatLengthOptions.map(opt => (
                                <ToggleButton key={opt.value} value={opt.value} title={opt.title}
                                    sx={{ px: 2.5, pt: 2.5, pb: 0.5 }}>
                                    <span style={bravuraStyle}>{opt.glyph}</span>
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </div>

                    <div>
                        <Typography gutterBottom>Loop Tolerance (max. scale difference)</Typography>
                        <Slider
                            value={scaleTolerance}
                            onChange={(_, value) => setScaleTolerance(value as number)}
                            step={0.25}
                            min={0}
                            max={5}
                            marks={toleranceMarks}
                            valueLabelDisplay="auto"
                        />
                    </div>

                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={neutralEnd}
                                onChange={(e) => setNeutralEnd(e.target.checked)}
                                color="primary"
                            />
                        }
                        label="Neutral End"
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={() => {
                        onDone({ ...cell, beatLength, name, neutralEnd }, scaleTolerance)
                    }}
                    startIcon={<Add />}
                >
                    Insert
                </Button>
            </DialogActions>
        </Dialog>
    )
}
