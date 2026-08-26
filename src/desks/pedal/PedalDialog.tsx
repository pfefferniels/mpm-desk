import { ArrowDownward, ArrowUpward } from "@mui/icons-material";
import { Stack, Box, Slider, Dialog, DialogContent, DialogActions, Button, ToggleButtonGroup, ToggleButton } from "@mui/material";
import type { InsertPedalOptions } from "../../fitting/transformers/pedal/InsertPedalInstructions";
import type { AlignedPedal } from "../../fitting/alignment";
import type { Residual } from "../../fitting/residual";
import { useState } from "react";

interface PedalDialogProps {
    open: boolean;
    onClose: () => void;
    onDone: (options: InsertPedalOptions) => void;
    pedal: AlignedPedal;
    /**
     * Where the recorded pedals fall on the tick grid. The dialog asks it one thing only:
     * whether *this* pedal can be placed at all.
     */
    residual: Residual;
}

type Direction = 'down' | 'up'
type Frame = Pick<InsertPedalOptions, 'start' | 'duration'>

export const PedalDialog = ({ open, onClose, onDone, pedal, residual }: PedalDialogProps) => {
    const [frame, setFrame] = useState<Frame>({ start: -100, duration: 200 });
    const [depth, setDepth] = useState(1);
    const [direction, setDirection] = useState<Direction>('down')

    // An unplaceable pedal — no `<tempo>` covers it — has no frame to hang a movement off, so
    // there is nothing to offer.
    const placed = residual.ofPedal(pedal)
    if (placed?.tickDate === undefined || !placed.tickDuration) return null

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogContent>
                <Stack direction='column' sx={{ width: '400px' }} spacing={1} p={1}>
                    <ToggleButtonGroup
                        value={direction}
                        exclusive
                        onChange={(_, value) => {
                            if (value) setDirection(value)
                        }}
                        aria-label="text alignment"
                    >
                        <ToggleButton value="down">
                            <ArrowDownward />
                        </ToggleButton>
                        <ToggleButton value="up">
                            <ArrowUpward />
                        </ToggleButton>
                    </ToggleButtonGroup>
                    <Box>
                        <Slider
                            value={[frame.start, frame.start + frame.duration]}
                            onChange={(_, value) => {
                                if (!Array.isArray(value) || value.length !== 2) return
                                setFrame({
                                    start: value[0],
                                    duration: value[1] - value[0]
                                })
                            }}
                            step={1}
                            marks={true}
                            valueLabelDisplay="auto"
                            min={-1000}
                            max={1000}
                            valueLabelFormat={(_, index) => {
                                if (index === 0) return `relative start: ${frame.start}`
                                if (index === 1) return `movement duration: ${frame.duration}`
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
                        onDone({ pedal: pedal["xml:id"], ...frame, depth, direction });
                        onClose()
                    }}
                >
                    Insert Pedal
                </Button>
            </DialogActions>
        </Dialog>
    )
}