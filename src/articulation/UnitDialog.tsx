import { UnitWithDef } from "./ArticulationDesk"
import { ArticulationProperty } from "mpmify"
import { useState } from "react"
import { useEffect } from "react"
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    Checkbox,
    FormGroup,
    FormControlLabel,
} from "@mui/material"

interface UnitDialogProps {
    unit: UnitWithDef
    open: boolean
    onClose: () => void
    onDone: (unit: UnitWithDef) => void
}

export const UnitDialog = ({ unit, open, onClose, onDone }: UnitDialogProps) => {
    const [aspects, setAspects] = useState<Set<ArticulationProperty>>(unit.aspects)
    const [name, setName] = useState(unit.name)

    useEffect(() => {
        if (open) {
            setName(unit.name)
            setAspects(unit.aspects)
        }
    }, [open, unit])

    const handleCheckboxChange = (property: ArticulationProperty) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const newAspects = new Set(aspects)
        if (e.target.checked) {
            newAspects.add(property)
        } else {
            newAspects.delete(property)
        }
        setAspects(newAspects)
    }

    const handleDone = () => {
        onDone({ ...unit, name, aspects })
    }

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>Edit Unit</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    label="Name"
                    fullWidth
                    variant="standard"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <FormGroup>
                    {["relativeDuration", "relativeVelocity", 'absoluteDuration', 'absoluteDurationChange'].map((property) => (
                        <FormControlLabel
                            key={property}
                            control={
                                <Checkbox
                                    checked={aspects.has(property as ArticulationProperty)}
                                    onChange={handleCheckboxChange(property as ArticulationProperty)}
                                />
                            }
                            label={property}
                        />
                    ))}
                </FormGroup>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleDone}>Done</Button>
            </DialogActions>
        </Dialog>
    )
}
