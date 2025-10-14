import { Stack, Box, Typography, Slider, Dialog, DialogContent, DialogActions, Button } from "@mui/material";
import { InsertPedalOptions, MovementFrame } from "mpmify";
import { MsmPedal } from "mpmify/lib/msm";
import { useEffect, useState } from "react";

interface PedalDialogProps {
    open: boolean;
    onClose: () => void;
    onDone: (options: InsertPedalOptions) => void;
    pedal: MsmPedal;
}

export const PedalDialog = ({ open, onClose, onDone, pedal }: PedalDialogProps) => {
    const [values, setValues] = useState([0]);
    const [depth, setDepth] = useState(1);

    useEffect(() => {
        if (!pedal.tickDate || !pedal.tickDuration) return

        const defaultDuration = 50
        setValues([
            pedal.tickDate - defaultDuration,
            pedal.tickDate + defaultDuration,
            pedal.tickDate + pedal.tickDuration - defaultDuration,
            pedal.tickDate + pedal.tickDuration + defaultDuration
        ])
    }, [pedal])

    if (!pedal.tickDate || !pedal.tickDuration) return null

    const marks = [
        { value: pedal.tickDate, label: 'Down' },
        { value: pedal.tickDate + pedal.tickDuration, label: 'Up' },
    ]

    if (values.length !== 4) return null

    const down: MovementFrame = {
        start: values[0] - pedal.tickDate,
        duration: values[1] - values[0]
    }

    const up: MovementFrame = {
        start: values[2] - (pedal.tickDate + pedal.tickDuration),
        duration: values[3] - values[2]
    }

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogContent>
                <Stack direction='column' sx={{ width: '400px' }} spacing={1} p={1}>
                    <Box>
                        <Slider
                            value={values}
                            onChange={(_, value) => {
                                if (!Array.isArray(value) || value.length !== 4) return
                                const isSorted = value.every((v, i, a) => !i || a[i - 1] <= v);
                                if (!isSorted) return

                                setValues(value as number[])
                            }}
                            step={1}
                            marks={marks}
                            valueLabelDisplay="auto"
                            min={pedal.tickDate - 1000}
                            max={pedal.tickDate + pedal.tickDuration + 1000}
                            valueLabelFormat={(_, index) => {
                                if (index === 0) return `relative down start: ${down.start}`
                                if (index === 1) return `down duration: ${down.duration}`
                                if (index === 2) return `relative up start: ${up.start}`
                                if (index === 3) return `up duration: ${up.duration}`
                            }}
                        />
                    </Box>
                    <Box>
                        <Slider
                            value={depth}
                            onChange={(_, value) => setDepth(value as number)}
                            step={0.05}
                            marks={[{ value: 0, label: 'up' }, { value: 0.5, label: 'halfway' }, { value: 1, label: 'full' }]}
                            min={0}
                            max={1}
                            valueLabelDisplay="auto"
                        />
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    onClick={() => {
                        onDone({ pedal: pedal["xml:id"], down, up, depth });
                        onClose()
                    }}
                >
                    Insert Pedal
                </Button>
            </DialogActions>
        </Dialog>
    )
}