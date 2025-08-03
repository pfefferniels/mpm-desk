import { Button, Dialog, DialogActions, DialogContent, MenuItem, Select, TextField } from "@mui/material";
import { Argumentation, BeliefValue, beliefValues } from "mpmify";
import { useEffect, useState } from "react";

interface ArgumentationDialogProps {
    open: boolean;
    onClose: () => void;
    onChange(): void;
    argumentation: Argumentation;
}

export const ArgumentationDialog = ({ open, onClose, onChange, argumentation }: ArgumentationDialogProps) => {
    const [id, setID] = useState(argumentation.id);
    const [description, setDescription] = useState(argumentation.conclusion.description);
    const [certainty, setCertainty] = useState(argumentation.conclusion.certainty);
    const [note, setNote] = useState(argumentation.note);

    useEffect(() => {
        setID(argumentation.id);
        setNote(argumentation.note);
        setDescription(argumentation.conclusion.description);
        setCertainty(argumentation.conclusion.certainty);
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
                    label="Belief"
                    placeholder={`Describe the musical intention of the set of transformations.`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    fullWidth
                    margin="normal"
                    multiline
                    rows={3}
                />
                <Select
                    label="Certainty"
                    value={certainty || ''}
                    onChange={(e) => setCertainty(e.target.value as BeliefValue)}
                    fullWidth
                >
                    {beliefValues.map(value => {
                        return (
                            <MenuItem key={`belief_${value}`} value={value}>
                                {value}
                            </MenuItem>
                        )
                    })}
                    <MenuItem value=''>
                        (not defined)
                    </MenuItem>
                </Select>
                <TextField
                    label="Reason"
                    placeholder={`Why does the set of transformations
                        represent the musical intention described above?`}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    fullWidth
                    margin="normal"
                    multiline
                    rows={3}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        argumentation.id = id;
                        argumentation.note = note;

                        argumentation.conclusion.certainty = certainty
                        argumentation.conclusion.description = description

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