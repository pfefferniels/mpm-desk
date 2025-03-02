import { Button, Drawer, TextField } from "@mui/material"
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

    useEffect(() => {
        setBeatLength(cell.beatLength);
        setName(cell.name ?? "");
    }, [cell]);

    return (
        <Drawer anchor="left" open={open} onClose={onClose}>
            <div style={{ width: 300, padding: 16 }}>
                <h2>Edit Accentuation Cell</h2>
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
            </div>
        </Drawer>
    )
}