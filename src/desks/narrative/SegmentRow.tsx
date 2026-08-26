import { memo } from 'react';
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
    /** One beat in ticks, for the grid behind the drawn lanes. */
    beatLength: number;
    activeCallIds: Set<string>;
    onPatch: (id: string, changes: Partial<Segment>) => void;
    onToggleCall: (id: string) => void;
    onAssignSelected: () => void;
    canAssign: boolean;
    onDissolve: () => void;
}

/**
 * One claim: what it says, and which of the performance it is a claim about.
 *
 * The narrative is editable in place — one field, because there is one thing a segment says, and
 * opening a dialog to change a word is the kind of friction that stops a reconstruction being
 * annotated at all. A `<textarea>` rather than an `<input>` because the field now carries the
 * longer prose too, and a sentence that scrolls sideways in a one-line box is a sentence nobody
 * re-reads.
 *
 * What the claim covers is drawn rather than tallied. "3 tempo, 1 rubato" says how many gestures
 * it holds and nothing about them; the same lanes the viewer draws say when each one falls, how
 * they lie against each other, and — for tempo, dynamics and the pedals — what shape they have.
 * Beside them the instructions themselves, as chips, because the drawing is the reading and the
 * chips are the handle: they are what moves between claims.
 *
 * The one thing a drawing cannot show is what is no longer there, so the count of instructions a
 * later call overwrote is still written out beneath it.
 */
export const SegmentRow = memo(
    ({
        segment,
        gestures,
        instructions,
        overwritten,
        performance,
        minPointSpan,
        beatLength,
        activeCallIds,
        onPatch,
        onToggleCall,
        onAssignSelected,
        canAssign,
        onDissolve,
    }: SegmentRowProps) => {
        return (
            <tr style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                <td style={cell}>
                    <textarea
                        value={segment.note ?? ''}
                        placeholder="unnamed"
                        rows={Math.min(4, Math.ceil(((segment.note ?? '').length || 1) / 34))}
                        onChange={(event) => {
                            onPatch(segment.id, { note: event.target.value || undefined });
                        }}
                        style={{
                            width: 260,
                            border: '1px solid transparent',
                            borderRadius: 4,
                            padding: '3px 5px',
                            fontFamily: '"EB Garamond", Garamond, serif',
                            fontSize: 14,
                            lineHeight: 1.3,
                            resize: 'vertical',
                            background: segment.note ? 'transparent' : '#fffbeb',
                        }}
                    />
                </td>



                <td style={{ ...cell, color: '#6b7280' }}>
                    <SegmentGestures
                        gestures={gestures}
                        mpm={performance}
                        minPointSpan={minPointSpan}
                        beatLength={beatLength}
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
