import { Stack, Box, Typography, Slider, Dialog, DialogContent, DialogActions, Button } from "@mui/material";
import { InsertPedalOptions } from "mpmify";
import { useState } from "react";

interface PedalDialogProps {
    open: boolean;
    onClose: () => void;
    onDone: (options: InsertPedalOptions) => void;
    pedalId?: string;
}

export const PedalDialog = ({ open, onClose, onDone, pedalId }: PedalDialogProps) => {
    const [changeDuration, setChangeDuration] = useState(0);
    const [depth, setDepth] = useState(1);

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogContent>
                <Stack direction='column' sx={{ maxWidth: '300px' }} spacing={1} p={1}>
                    <Box>
                        <Typography id="change-duration-slider" gutterBottom>
                            Change Duration: {changeDuration}
                        </Typography>
                        <Slider
                            value={changeDuration}
                            onChange={(_, value) => setChangeDuration(value as number)}
                            step={1}
                            marks={[{ value: 0, label: '0' }, { value: 100, label: '100' }, { value: 200, label: '200' }]}
                            min={0}
                            max={200}
                        />
                    </Box>
                    <Box>
                        <Typography id="change-depth-slider" gutterBottom>
                            Depth: {depth}
                        </Typography>
                        <Slider
                            value={depth}
                            onChange={(_, value) => setDepth(value as number)}
                            step={0.05}
                            marks={[{ value: 0, label: 'up' }, { value: 0.5, label: 'halfway' }, { value: 1, label: 'full' }]}
                            min={0}
                            max={1}
                        />
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    onClick={() => {
                        onDone({ pedal: pedalId, changeDuration, depth });
                        onClose()
                    }}
                >
                    Insert Pedal
                </Button>
            </DialogActions>
        </Dialog>
    )
}