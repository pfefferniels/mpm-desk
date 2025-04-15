import { Button, Dialog, DialogActions, DialogContent, TextField } from "@mui/material";
import { Transformer } from "mpmify/lib/transformers/Transformer";
import { useEffect, useState } from "react";

interface TransformerDialogProps {
    open: boolean;
    onClose: () => void;
    onChange(transformer: Transformer): void;
    transformer: Transformer;
}

export const TransformerDialog = ({ open, onClose, onChange, transformer }: TransformerDialogProps) => {
    const [id, setID] = useState(transformer.id);
    const [note, setNote] = useState(transformer.note);

    useEffect(() => {
        setID(transformer.id);
        setNote(transformer.note);
    }, [transformer]);

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
                        transformer.id = id;
                        transformer.note = note;
                        onChange(transformer);
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