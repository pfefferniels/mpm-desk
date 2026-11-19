import { Paper, Typography } from '@mui/material';
import { EXTRA_COLOUR } from '../../verovio/extraNotes';
import { OMITTED_COLOUR } from '../../verovio/omissionMarks';
import { MATCHED_COLOUR, REPLACED_COLOUR, SELECTED_COLOUR } from './paintAlignment';
import type { Excerpt, RollKind } from './rollExcerpt';

const COLOUR: Record<RollKind, string> = {
    matched: MATCHED_COLOUR,
    added: EXTRA_COLOUR,
    replaced: REPLACED_COLOUR,
    unplayed: OMITTED_COLOUR,
};

const WIDTH = 360;
/** How tall one key is drawn, at most and at least: a bar of few keys is not a bar of fat ones */
const ROW = { most: 9, least: 4 };
/** How tall the roll may get, before the keys are drawn thinner */
const TALLEST = 200;

/** A moment of the recording as minutes, seconds and tenths, the way the transport shows it. */
const clock = (ms: number) => {
    const seconds = Math.max(0, ms) / 1000;
    return `${String(Math.floor(seconds / 60))}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
};

/**
 * A bar as it was played, drawn as a piano roll: one bar per key, as long as it was held, in the
 * colours the page draws the notes in. A written note nobody played is an outline where it was
 * due, since there is nothing played to fill it with. The note the pointer is on is ringed.
 */
export const RollPreview = ({ excerpt, bar }: { excerpt: Excerpt; bar?: string }) => {
    const { fromMs, toMs, low, high, notes } = excerpt;
    const keys = high - low + 1;
    const row = Math.max(ROW.least, Math.min(ROW.most, TALLEST / keys));
    const height = row * keys;
    const x = (ms: number) => ((ms - fromMs) / (toMs - fromMs)) * WIDTH;
    const y = (pitch: number) => (high - pitch) * row;

    // A faint line at every C, so that the eye has an octave to count by
    const octaves = [];
    for (let pitch = Math.ceil(low / 12) * 12; pitch <= high; pitch += 12) octaves.push(pitch);
    // And at every second
    const seconds = [];
    for (let s = Math.ceil(fromMs / 1000) * 1000; s <= toMs; s += 1000) seconds.push(s);

    return (
        <Paper elevation={4} sx={{ p: 1, pointerEvents: 'none' }} data-roll-preview>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                {bar !== undefined ? `Bar ${bar}, as played` : 'As played'} · {clock(fromMs)}–{clock(toMs)}
            </Typography>
            <svg width={WIDTH} height={height} role="img" aria-label="The bar as it was played">
                <rect width={WIDTH} height={height} fill="#f8fafc" />
                {octaves.map((pitch) => (
                    <line key={`c${String(pitch)}`} x1={0} x2={WIDTH} y1={y(pitch) + row} y2={y(pitch) + row} stroke="#e2e8f0" />
                ))}
                {seconds.map((ms) => (
                    <line key={`s${String(ms)}`} x1={x(ms)} x2={x(ms)} y1={0} y2={height} stroke="#e2e8f0" />
                ))}
                {notes.map((note, index) => {
                    const left = Math.max(0, x(note.onsetMs));
                    const right = Math.min(WIDTH, x(note.offsetMs));
                    const unplayed = note.kind === 'unplayed';
                    return (
                        <rect
                            key={index}
                            data-kind={note.kind}
                            x={left}
                            y={y(note.pitch) + 0.5}
                            width={Math.max(2, right - left)}
                            height={Math.max(2, row - 1)}
                            rx={1}
                            fill={unplayed ? 'none' : COLOUR[note.kind]}
                            fillOpacity={unplayed ? undefined : 0.85}
                            stroke={note.hovered ? SELECTED_COLOUR : unplayed ? COLOUR.unplayed : 'none'}
                            strokeWidth={note.hovered ? 2 : 1}
                            strokeDasharray={unplayed && !note.hovered ? '3 2' : undefined}
                        />
                    );
                })}
            </svg>
        </Paper>
    );
};
