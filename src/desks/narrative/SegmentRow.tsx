import { memo, useCallback, useEffect, useRef } from 'react';
import type { Segment } from '../../model/Work';
import type { Segment as Gestures } from '../../model/Reconstruction';
import type { PerformanceReader } from '../../utils/mpm';
import { SegmentGestures } from './SegmentGestures';
import { InstructionChips, type Instruction } from './InstructionChips';

interface SegmentRowProps {
    segment: Segment;
    /** The same segment as the last run projected it: its spans, on the ticks they act at. */
    gestures: Gestures | undefined;
    /** The MPM instructions the segment holds, gathered through the calls that name it. */
    instructions: readonly Instruction[];
    /** Instructions its calls wrote that a later call removed or merged away again. */
    overwritten: number;
    performance: PerformanceReader;
    /** Gives a segment that acts on a single point a width to be drawn over. */
    minPointSpan: number;
    activeCallIds: Set<string>;
    /** The playhead is inside this claim, or one of its instructions is being auditioned. */
    playing: boolean;
    /** The instruction of this row being auditioned, if the click was here. */
    playingInstructionId: string | null;
    onPatch: (id: string, changes: Partial<Segment>) => void;
    onToggleCall: (id: string) => void;
    onPlayInstruction: (instruction: Instruction, segmentId: string) => void;
    onAssignSelected: () => void;
    canAssign: boolean;
    onDissolve: () => void;
}

/**
 * One claim: what it says, and which of the performance it is a claim about.
 *
 * The narrative is editable in place, in one field because there is one thing a segment says:
 * opening a dialog to change a word is the friction that stops a reconstruction being annotated
 * at all. A `<textarea>` rather than an `<input>` because the field carries the longer prose too,
 * and a sentence that scrolls sideways in a one-line box is one nobody re-reads.
 *
 * What the claim covers is drawn rather than tallied. "3 tempo, 1 rubato" says how many gestures
 * it holds and nothing about them, where the viewer's own lanes say when each falls, how they lie
 * against each other, and what shape they have. Beside them the instructions as chips, the
 * drawing being the reading and the chips the handle that moves between claims.
 *
 * A drawing cannot show what is no longer there, so the count of instructions a later call
 * overwrote is written out beneath it.
 *
 * **A row lights up while it sounds**, the viewer's spotlight in a table. The playhead lights
 * every claim with an instruction in effect and scrolls the row into view, and a clicked chip
 * lights its own row for as long as its preview runs. One look for both.
 */
export const SegmentRow = memo(
    ({
        segment,
        gestures,
        instructions,
        overwritten,
        performance,
        minPointSpan,
        activeCallIds,
        playing,
        playingInstructionId,
        onPatch,
        onToggleCall,
        onPlayInstruction,
        onAssignSelected,
        canAssign,
        onDissolve,
    }: SegmentRowProps) => {
        const rowRef = useRef<HTMLTableRowElement>(null);

        // Follow the playhead down the table. `nearest`, so a row already on screen — the one
        // whose chip was just clicked — stays exactly where the hand left it.
        useEffect(() => {
            if (playing) rowRef.current?.scrollIntoView?.({ block: 'nearest' });
        }, [playing]);

        const play = useCallback(
            (instruction: Instruction) => {
                onPlayInstruction(instruction, segment.id);
            },
            [onPlayInstruction, segment.id],
        );

        return (
            <tr
                ref={rowRef}
                data-segment-id={segment.id}
                aria-current={playing ? 'true' : undefined}
                style={{
                    borderBottom: '1px solid #f3f4f6',
                    verticalAlign: 'top',
                    background: playing ? '#f3f4f6' : undefined,
                    // Clear of the sticky header when the follow scrolls the row to the top.
                    scrollMarginTop: 36,
                }}
            >
                <td style={{ ...cell, borderLeft: `3px solid ${playing ? '#111827' : 'transparent'}` }}>
                    <textarea
                        value={segment.note ?? ''}
                        placeholder="unnamed"
                        rows={Math.min(4, Math.ceil(((segment.note ?? '').length || 1) / 34))}
                        onChange={(event) => {
                            onPatch(segment.id, { note: event.target.value || undefined });
                        }}
                        style={{
                            // 272 and not 260: `CssBaseline` sets `box-sizing: border-box`
                            // app-wide, so the 5px of padding and 1px of border on each side come
                            // out of the stated width rather than sitting outside it.
                            width: 272,
                            // An empty word is marked by a dashed outline rather than a fill: a
                            // filled cell reads as loudly as the genuine `#fcd34d` warning in
                            // `UngroupedInstructions.tsx`, for what is only an invitation to
                            // type. Solid-transparent in the other state, so the box keeps its
                            // 1px on every side and the field does not jump width when named.
                            border: segment.note ? '1px solid transparent' : '1px dashed #e5e7eb',
                            borderRadius: 4,
                            padding: '3px 5px',
                            fontFamily: '"EB Garamond", Garamond, serif',
                            fontSize: 14,
                            fontWeight: playing ? 600 : 400,
                            color: playing ? '#111827' : undefined,
                            lineHeight: 1.3,
                            resize: 'vertical',
                            background: 'transparent',
                        }}
                    />
                </td>



                <td style={{ ...cell, color: '#6b7280' }}>
                    <SegmentGestures
                        gestures={gestures}
                        mpm={performance}
                        minPointSpan={minPointSpan}
                    />
                    {overwritten > 0 && (
                        <div
                            style={{ color: '#b45309', fontSize: 11 }}
                            title="A later call in the chain removed or merged these away again."
                        >
                            {overwritten} overwritten
                        </div>
                    )}
                </td>

                <td style={cell}>
                    <InstructionChips
                        instructions={instructions}
                        activeCallIds={activeCallIds}
                        onToggleCall={onToggleCall}
                        onPlay={play}
                        playingId={playingInstructionId}
                    />
                </td>

                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button
                        type="button"
                        onClick={onAssignSelected}
                        disabled={!canAssign}
                        style={{ ...action, opacity: canAssign ? 1 : 0.4 }}
                        title="Move the selected instructions into this segment"
                    >
                        ← assign
                    </button>
                    <button
                        type="button"
                        onClick={onDissolve}
                        style={action}
                        title="Remove the grouping. The instructions survive and become ungrouped."
                    >
                        dissolve
                    </button>
                </td>
            </tr>
        );
    },
);

SegmentRow.displayName = 'SegmentRow';

const cell: React.CSSProperties = { padding: '5px 10px' };
const action: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 11,
    cursor: 'pointer',
    marginRight: 4,
};
