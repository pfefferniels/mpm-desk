import React, { } from 'react';
import { Button, Dialog, DialogActions, DialogContent, TextField } from '@mui/material';
import { DynamicsGradient } from 'mpmify';

interface GradientDetailsProps {
    gradient?: DynamicsGradient;
    open: boolean;
    onChange: (gradient: DynamicsGradient) => void
    onDone: () => void
    onClose: () => void
}

const GradientDetails: React.FC<GradientDetailsProps> = ({ gradient, open, onChange, onClose, onDone }) => {
    console.log('gradient', gradient)
    
    return (
        <Dialog open={open} onClose={onClose}>
            <DialogContent>
                <TextField
                    label="From"
                    type="number"
                    fullWidth
                    margin="normal"
                    inputProps={{ min: -1, max: 1, step: 0.1 }}
                    value={gradient?.from || 0}
                    onChange={(e) =>
                        onChange({ from: parseFloat(e.target.value) || 0, to: gradient?.to || 0 })
                    }
                />
                <TextField
                    label="To"
                    type="number"
                    fullWidth
                    margin="normal"
                    inputProps={{ min: -1, max: 1, step: 0.1 }}
                    value={gradient?.to || 0}
                    onChange={(e) =>
                        onChange({ from: gradient?.from || 0, to: parseFloat(e.target.value) || 0 })
                    }
                />
            </DialogContent>
            <DialogActions>
                <Button
                    variant='contained'
                    onClick={() => onDone()}
                >
                    Insert
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default GradientDetails;