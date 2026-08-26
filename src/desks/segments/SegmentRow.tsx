import { memo } from 'react';
import type { Call, Segment } from '../../model/Work';

interface SegmentRowProps {
    segment: Segment;
    callById: ReadonlyMap<string, Call>;
    typeById: ReadonlyMap<string, string>;
    activeCallIds: Set<string>;
    onPatch: (id: string, changes: Partial<Segment>) => void;
    onToggleCall: (id: string) => void;
    onAssignSelected: () => void;
    canAssign: boolean;
    onDissolve: () => void;
}

/**
 * One segment: what it claims, and what it is resting on.
 *
 * The word, the motivation and the certainty are editable in place — they are short, and opening
 * a dialog to change one word is the kind of friction that stops a reconstruction being
 * annotated at all. The calls are chips rather than a list, because their names repeat
 * (`InsertPedal` a hundred times) and what distinguishes them is the tick they act at.
 *
 * `elements` is shown as a tally by type rather than as ids. An `xml:id` is not a thing anyone
 * reads; "3 tempo, 1 rubato" is what tells you whether this segment is the one you meant.
 */
export const SegmentRow = memo(
    ({
        segment,
        callById,
        typeById,
        activeCallIds,
        onPatch,
        onToggleCall,
        onAssignSelected,
        canAssign,
        onDissolve,
    }: SegmentRowProps) => {
        const tally = new Map<string, number>();
        let missing = 0;
        for (const id of segment.calls.flatMap((callId) => callById.get(callId)?.elements ?? [])) {
            const type = typeById.get(id);
            if (!type) {
                missing++;
                continue;
            }
            tally.set(type, (tally.get(type) ?? 0) + 1);
        }

        return (
            <tr style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                <td style={cell}>
                    <input
                        value={segment.note ?? ''}
                        placeholder="unnamed"
                        onChange={(event) => {
                            onPatch(segment.id, { note: event.target.value || undefined });
                        }}
                        style={{
                            width: '100%',
                            minWidth: 180,
                            border: '1px solid transparent',
                            borderRadius: 4,
                            padding: '3px 5px',
                            fontFamily: '"EB Garamond", Garamond, serif',
                            fontSize: 14,
                            background: segment.note ? 'transparent' : '#fffbeb',
                        }}
                    />
                    {segment.commentary && (
                        <div
                            style={{ color: '#6b7280', fontSize: 11, padding: '2px 5px', maxWidth: 320 }}
                            title={segment.commentary}
                        >
                            {segment.commentary}
                        </div>
                    )}
                </td>



                <td style={cell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 420 }}>
                        {segment.calls.map((id) => {
                            const call = callById.get(id);
                            const on = activeCallIds.has(id);
                            const at = call ? tickOf(call) : null;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => {
                                        onToggleCall(id);
                                    }}
                                    title={call ? `${call.name} · ${id}` : id}
                                    style={{
                                        border: '1px solid',
                                        borderColor: on ? '#111827' : '#e5e7eb',
                                        background: on ? '#111827' : '#ffffff',
                                        color: on ? '#ffffff' : '#374151',
                                        borderRadius: 4,
                                        padding: '1px 5px',
                                        fontSize: 10,
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {call?.name.replace(/^Insert|^Make|^Stylize|^Merge/, '') ?? '?'}
                                    {at ? ` @${at}` : ''}
                                </button>
                            );
                        })}
                        {segment.calls.length === 0 && (
                            <span style={{ color: '#b45309', fontSize: 11 }}>no calls</span>
                        )}
                    </div>
                </td>

                <td style={{ ...cell, color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {[...tally].map(([type, n]) => `${String(n)} ${type}`).join(', ') || '—'}
                    {missing > 0 && (
                        <div
                            style={{ color: '#b45309', fontSize: 11 }}
                            title="A later call in the chain removed or merged these away again."
                        >
                            {missing} overwritten
                        </div>
                    )}
                </td>

                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button
                        type="button"
                        onClick={onAssignSelected}
                        disabled={!canAssign}
                        style={{ ...action, opacity: canAssign ? 1 : 0.4 }}
                        title="Move the selected calls into this segment"
                    >
                        ← assign
                    </button>
                    <button
                        type="button"
                        onClick={onDissolve}
                        style={action}
                        title="Remove the grouping. The calls survive and become ungrouped."
                    >
                        dissolve
                    </button>
                </td>
            </tr>
        );
    },
);

SegmentRow.displayName = 'SegmentRow';

/**
 * Where a call acts, as its own options state it.
 *
 * Read off the options rather than the fit, because this list has to be readable before a fit
 * lands and for a call whose instructions a later one overwrote. A call that names neither a
 * `from` nor a `date` acts on notes rather than on a place, and shows no tick at all.
 */
const tickOf = (call: Call): string | null => {
    const options = call.options as { from?: unknown; date?: unknown };
    if (typeof options.from === 'number') return String(options.from);
    if (typeof options.date === 'number') return String(options.date);
    return null;
};

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
