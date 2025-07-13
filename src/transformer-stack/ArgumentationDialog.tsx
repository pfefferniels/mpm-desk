import { Button, Dialog, DialogActions, DialogContent, TextField } from "@mui/material";
import { Argumentation } from "mpmify";
import { useEffect, useState } from "react";

interface ArgumentationDialogProps {
    open: boolean;
    onClose: () => void;
    onChange(): void;
    argumentation: Argumentation;
}

export const ArgumentationDialog = ({ open, onClose, onChange, argumentation }: ArgumentationDialogProps) => {
    const [id, setID] = useState(argumentation.id);
    const [note, setNote] = useState(argumentation.description);

    useEffect(() => {
        setID(argumentation.id);
        setNote(argumentation.description);
    }, [argumentation]);

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogContent>
                <TextField
                    label="ID"
                    value={id}
                    onChange={(e) => setID(e.target.value)}
                    fullWidth
                    margin="normal"
                />
                <TextField
                    label="Note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    fullWidth
                    margin="normal"
                    multiline
                    rows={4}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        argumentation.id = id;
                        argumentation.description = note;
                        onChange();
                        onClose();
                    }}
                    variant='contained'
                >
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    )
}