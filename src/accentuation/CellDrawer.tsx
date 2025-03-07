import { Button, Checkbox, Drawer, FormControlLabel, Stack, TextField } from "@mui/material"
import { AccentuationCell } from "mpmify"
import { useState, useEffect } from "react";

interface CellDrawerProps {
    open: boolean
    onClose: () => void
    cell: AccentuationCell
    onChange: (newCell: AccentuationCell) => void
}

export const CellDrawer = ({ open, onClose, cell, onChange }: CellDrawerProps) => {
    const [beatLength, setBeatLength] = useState(cell.beatLength);
    const [name, setName] = useState(cell.name ?? "");
    const [neutralEnd, setNeutralEnd] = useState(cell.neutralEnd || false);

    useEffect(() => {
        setBeatLength(cell.beatLength);
        setName(cell.name ?? "");
        setNeutralEnd(cell.neutralEnd || false);
    }, [cell]);

    return (
        <Drawer anchor="left" open={open} onClose={onClose} variant='persistent'>
            <div style={{ width: 300, padding: 16 }}>
                <h2>Edit Accentuation Cell</h2>
                <Stack direction='column' spacing={1}>

                    <TextField
                        label="Beat Length"
                        type="number"
                        value={beatLength}
                        onChange={(e) => setBeatLength(Number(e.target.value))}
                        fullWidth
                        margin="normal"
                    />
                    <TextField
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        fullWidth
                        margin="normal"
                    />
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
                    <Button
                        variant="contained"
                        onClick={() => {
                            const updatedCell = { ...cell, beatLength, name };
                            onChange(updatedCell)
                            onClose()
                        }}
                        color="primary"
                    >
                        Save Changes
                    </Button>
                </Stack>
            </div>
        </Drawer>
    )
}