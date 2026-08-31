import { UnitWithDef } from "./ArticulationDesk"
import type { ArticulationProperty } from "../../fitting/transformers/articulation/index"
import { useState } from "react"
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
    FormHelperText,
} from "@mui/material"

const properties: readonly ArticulationProperty[] = [
    'relativeDuration',
    'relativeVelocity',
    'absoluteDuration',
    'absoluteDurationChange',
]

/**
 * The three aspects measured against the recorded duration on the tick grid, which only a
 * `<tempo>` puts there. Ticked without one they carry no value, and `makeArticulationDef` writes
 * only what it was given, so a unit of the three yields an `<articulationDef>` stating nothing at
 * all (issue #39).
 */
const tickBorne: readonly ArticulationProperty[] = [
    'relativeDuration',
    'absoluteDuration',
    'absoluteDurationChange',
]

interface UnitDialogProps {
    unit: UnitWithDef
    /** Whether any note of the unit has a recorded duration on the tick grid. */
    durationMeasured: boolean
    open: boolean
    onClose: () => void
    onDone: (unit: UnitWithDef) => void
}

export const UnitDialog = ({ unit, durationMeasured, open, onClose, onDone }: UnitDialogProps) => {
    // Seeded from the unit once, at mount. The caller keys this dialog by the unit and only
    // renders it while it is open, so arriving at a different unit is a new mount with new
    // fields — no effect has to copy the props back over what the user has typed.
    const [aspects, setAspects] = useState<Set<ArticulationProperty>>(unit.aspects)
    const [name, setName] = useState(unit.name)

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
                    {properties.map((property) => (
                        <FormControlLabel
                            key={property}
                            disabled={!durationMeasured && tickBorne.includes(property)}
                            control={
                                <Checkbox
                                    checked={aspects.has(property)}
                                    onChange={handleCheckboxChange(property)}
                                />
                            }
                            label={property}
                        />
                    ))}
                </FormGroup>
                {!durationMeasured && (
                    <FormHelperText>
                        No tempo places these notes on the tick grid, so only relativeVelocity can be
                        measured. Draw one on the tempo desk first.
                    </FormHelperText>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleDone}>Done</Button>
            </DialogActions>
        </Dialog>
    )
}
