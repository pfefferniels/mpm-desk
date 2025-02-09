import React from 'react';
import { Drawer, TextField } from '@mui/material';
import { DynamicsGradient } from 'mpmify';

interface GradientDetailsProps {
    gradient?: DynamicsGradient;
    setGradient: (gradient: DynamicsGradient) => void;
    open: boolean;
    onClose: () => void;
}

const GradientDetails: React.FC<GradientDetailsProps> = ({ gradient, setGradient, open, onClose }) => {

    return (
        <Drawer anchor="right" open={open} onClose={onClose}>
            <div style={{ width: 300, padding: 16 }}>
                <TextField
                    label="From"
                    type="number"
                    fullWidth
                    margin="normal"
                    inputProps={{ min: -1, max: 1, step: 0.1 }}
                    value={gradient?.from || 0}
                    onChange={(e) =>
                        setGradient({ from: parseFloat(e.target.value) || 0, to: gradient?.to || 0 })
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
                        setGradient({ from: gradient?.from || 0, to: parseFloat(e.target.value) || 0 })
                    }
                />
            </div>
        </Drawer>
    );
};

export default GradientDetails;