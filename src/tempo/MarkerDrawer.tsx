import { Drawer, Box, FormControlLabel, Checkbox, Stack, TextField } from "@mui/material";
import { Marker } from "mpmify";

type MarkerDrawerProps = {
    marker: Marker;
    onChange: (marker: Marker) => void;
    onClose: () => void;
};

export const MarkerDrawer = ({ marker, onClose, onChange }: MarkerDrawerProps) => {
    return (
        <Drawer
            open={marker !== null}
            onClose={onClose}
        >
            <Stack direction='column' spacing={2}>
                <Box>
                    <TextField
                        label='Measured beat length'
                        type='number'
                        value={marker.measureBeatLength || marker.beatLength}
                        onChange={(e) => {
                            marker.measureBeatLength = parseFloat(e.target.value)
                            onChange(marker)
                        }}
                    />
                </Box>
                <Box padding={2}>
                    <FormControlLabel
                        control={<Checkbox
                            checked={marker.continuous || false}
                            onChange={(e) => {
                                marker.continuous = e.target.checked
                                onChange(marker)
                            }} />}
                        label="Continuous" />
                </Box>
            </Stack>
        </Drawer>
    );
}
