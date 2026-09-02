import { ArrowDownward, ArrowUpward } from "@mui/icons-material";
import { Stack, Box, Slider, Dialog, DialogContent, DialogActions, DialogTitle, Button, ToggleButtonGroup, ToggleButton } from "@mui/material";
import type { InsertPedalOptions } from "../../fitting/transformers/pedal/InsertPedalInstructions";
import type { AlignedPedal } from "../../fitting/alignment";
import type { Residual } from "../../fitting/residual";
import type { Direction } from "./PressBox";
import { useState } from "react";

interface PedalDialogProps {
    onClose: () => void;
    onDone: (options: InsertPedalOptions) => void;
    pedal: AlignedPedal;
    /** Which half of the press was clicked, which is the reading the dialog opens on. */
    direction: Direction;
    /**
     * Where the recorded pedals fall on the tick grid. The dialog asks it one thing only:
     * whether *this* pedal can be placed at all.
     */
    residual: Residual;
}

type Frame = Pick<InsertPedalOptions, 'start' | 'duration'>

export const PedalDialog = ({ onClose, onDone, pedal, direction: picked, residual }: PedalDialogProps) => {
    const [frame, setFrame] = useState<Frame>({ start: -100, duration: 200 });
    const [depth, setDepth] = useState(1);
    // The seed only. The desk mounts a dialog per click, so the field settles which movement is
    // being written, and the toggle below is free to disagree with it afterwards.
    const [direction, setDirection] = useState<Direction>(picked)

    // An unplaceable pedal — no `<tempo>` covers it — has no frame to hang a movement off, so
    // there is nothing to offer.
    const placed = residual.ofPedal(pedal)
    if (placed?.tickDate === undefined || !placed.tickDuration) return null

    // The edge the movement hangs off, which is the one the picked half stands for.
    const anchor = direction === 'down' ? placed.tickDate : placed.tickDate + placed.tickDuration

    return (
        <Dialog open onClose={onClose}>
            <DialogTitle>{`${pedal.type} ${direction} @${anchor}`}</DialogTitle>
            <DialogContent>
                <Stack direction='column' sx={{ width: '400px' }} spacing={1} p={1}>
                    <ToggleButtonGroup
                        value={direction}
                        exclusive
                        onChange={(_, value) => {
                            if (value) setDirection(value)
                        }}
                        aria-label="direction"
                    >
                        <ToggleButton value="down" aria-label="down">
                            <ArrowDownward />
                        </ToggleButton>
                        <ToggleButton value="up" aria-label="up">
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