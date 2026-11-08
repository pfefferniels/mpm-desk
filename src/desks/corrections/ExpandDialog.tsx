import { useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import { Add, Remove } from '@mui/icons-material';
import {
    expansion,
    type ExpandOptions,
    type ExpansionPoint,
} from '../../fitting/transformers/modification/Expand';

type Aspect = ExpandOptions['aspect'];

const UNIT: Record<Aspect, string> = { velocity: 'velocity', onset: 'ms', duration: 'ms' };

const ASPECT_LABEL: Record<Aspect, string> = {
    velocity: 'Velocity',
    onset: 'Onset',
    duration: 'Duration',
};

/** A row as typed: strings, so that a field can be half-written without being thrown away. */
type Row = [from: string, to: string];

/** The identity over the recorded range, which is where an expansion starts from. */
const identity = ([low, high]: [number, number]): Row[] => [
    [String(low), String(low)],
    [String(high), String(high)],
];

const parse = (rows: readonly Row[]): ExpansionPoint[] =>
    rows.map(([from, to]) => [from.trim() === '' ? NaN : Number(from), to.trim() === '' ? NaN : Number(to)]);

interface ExpandDialogProps {
    /** What the call will be about, in words: "3 notes", "every note", "every note and pedal". */
    about: string;
    /** The aspects to choose among: velocity on the velocity plot, onset or duration on the roll. */
    aspects: readonly Aspect[];
    /** The lowest and highest recorded value the call would reach, per aspect. */
    recorded: (aspect: Aspect) => [number, number];
    onClose: () => void;
    onApply: (aspect: Aspect, points: ExpansionPoint[]) => void;
}

/**
 * The points of an `Expand`, typed in.
 *
 * Not a gesture on the plot, unlike everything else on this desk: an expansion is a statement
 * about a scale — this recorded value becomes that one — and two numbers say it more exactly than
 * a drag could. It opens on the identity over the values the call would reach, so the first
 * thing to do is to change a "New" value; a third point goes between where the scale should bend.
 *
 * Mounted only while open, so it starts afresh each time.
 */
export const ExpandDialog = ({ about, aspects, recorded, onClose, onApply }: ExpandDialogProps) => {
    const [aspect, setAspect] = useState<Aspect>(aspects[0]);
    const [rows, setRows] = useState<Row[]>(() => identity(recorded(aspects[0])));

    const points = parse(rows);
    const map = expansion(points);
    const changes = points.some(([from, to]) => from !== to);
    const problem = !map
        ? 'Two points at least, with the recorded values rising from row to row.'
        : !changes
          ? 'Every point keeps its value: there is nothing to expand yet.'
          : undefined;

    const setCell = (row: number, column: 0 | 1, value: string) =>
        setRows((current) =>
            current.map((r, k) => (k === row ? (column === 0 ? [value, r[1]] : [r[0], value]) : r)),
        );

    /** A point halfway along the last stretch, so a new row is valid from the moment it appears. */
    const addPoint = () =>
        setRows((current) => {
            const last = parse(current.slice(-2));
            if (current.length < 2 || !expansion(last)) return [...current, ['', '']];
            const [[x0, y0], [x1, y1]] = last;
            const middle: Row = [String((x0 + x1) / 2), String((y0 + y1) / 2)];
            return [...current.slice(0, -1), middle, current[current.length - 1]];
        });

    return (
        <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Expand {about}</DialogTitle>
            <DialogContent>
                <DialogContentText variant="body2" sx={{ mb: 2 }}>
                    Map the recorded values onto new ones: between two points along a line, beyond
                    the outermost ones along the outermost line.
                </DialogContentText>

                {aspects.length > 1 && (
                    <ToggleButtonGroup
                        value={aspect}
                        exclusive
                        size="small"
                        sx={{ mb: 2 }}
                        onChange={(_, next: Aspect | null) => {
                            if (next === null || next === aspect) return;
                            setAspect(next);
                            setRows(identity(recorded(next)));
                        }}
                    >
                        {aspects.map((a) => (
                            <ToggleButton key={a} value={a}>
                                {ASPECT_LABEL[a]}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                )}

                <Stack spacing={1}>
                    {rows.map(([from, to], k) => (
                        <Stack key={k} direction="row" spacing={1} alignItems="center">
                            <TextField
                                label={`Recorded (${UNIT[aspect]})`}
                                type="number"
                                size="small"
                                value={from}
                                onChange={(e) => setCell(k, 0, e.target.value)}
                            />
                            <Typography aria-hidden>→</Typography>
                            <TextField
                                label={`New (${UNIT[aspect]})`}
                                type="number"
                                size="small"
                                value={to}
                                onChange={(e) => setCell(k, 1, e.target.value)}
                            />
                            <IconButton
                                aria-label="Remove this point"
                                size="small"
                                disabled={rows.length <= 2}
                                onClick={() => setRows((current) => current.filter((_, j) => j !== k))}
                            >
                                <Remove fontSize="small" />
                            </IconButton>
                        </Stack>
                    ))}
                </Stack>

                <Button startIcon={<Add />} size="small" sx={{ mt: 1 }} onClick={addPoint}>
                    Add a point
                </Button>

                {problem && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {problem}
                    </Typography>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    disabled={problem !== undefined}
                    onClick={() => onApply(aspect, points)}
                >
                    Apply
                </Button>
            </DialogActions>
        </Dialog>
    );
};
