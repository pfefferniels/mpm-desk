import { Dialog, DialogTitle, DialogContent, TextField, DialogActions, Button } from "@mui/material"
import { useState } from "react"

interface NameDialogProps {
    open: boolean
    onClose: () => void
    onDone: (name: string) => void
}

export const NameDialog = ({ open, onClose, onDone }: NameDialogProps) => {
    const [name, setName] = useState('')

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>Enter a Name</DialogTitle>
            <DialogContent>
                <TextField
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    fullWidth
                    margin="normal"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={() => {
                    onDone(name)
                    onClose()
                    setName('')
                }}>Done</Button>
            </DialogActions>
        </Dialog>
    )
}