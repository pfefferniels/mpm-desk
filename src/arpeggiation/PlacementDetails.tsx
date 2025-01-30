import React from 'react';
import { Drawer, Select, MenuItem, FormControl, InputLabel, SelectChangeEvent } from '@mui/material';
import { ArpeggioPlacement } from 'mpmify';

interface PlacementDetailsProps {
    placement: ArpeggioPlacement;
    setPlacement: (placement: ArpeggioPlacement) => void;
    open: boolean;
    onClose: () => void;
}

const PlacementDetails: React.FC<PlacementDetailsProps> = ({ placement, setPlacement, open, onClose }) => {
    const handleChange = (event: SelectChangeEvent<string>) => {
        setPlacement(event.target.value as 'on-beat' | 'before-beat' | 'estimate');
    };

    return (
        <Drawer anchor="right" open={open} onClose={onClose}>
            <div style={{ width: 250, padding: 16 }}>
                <FormControl fullWidth>
                    <InputLabel id="placement-select-label">Placement</InputLabel>
                    <Select
                        labelId="placement-select-label"
                        id="placement-select"
                        onChange={handleChange}
                        defaultValue="none"
                        value={placement}
                    >
                        <MenuItem value="on-beat">On Beat</MenuItem>
                        <MenuItem value="before-beat">Before Beat</MenuItem>
                        <MenuItem value="estimate">Estimate</MenuItem>
                        <MenuItem value="none">None (fallback to default)</MenuItem>
                    </Select>
                </FormControl>
            </div>
        </Drawer>
    );
};

export default PlacementDetails;