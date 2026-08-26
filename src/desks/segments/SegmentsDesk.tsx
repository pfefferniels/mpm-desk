import { useCallback, useMemo, useState } from 'react';
import { v4 } from 'uuid';
import { getInstructions } from '../../fitting/instructions/index';
import { useCallSelection } from '../../hooks/CallSelection';
import type { ViewProps } from '../TransformerViewProps';
import type { Call, Segment } from '../../model/Work';
import { SegmentRow } from './SegmentRow';
import { UngroupedCalls } from './UngroupedCalls';

/**
 * Grouping calls into segments, and saying what each group claims.
 *
 * A separate step, and a separate desk. The other desks answer "what did the performer do here";
 * this one answers "what am I claiming, and which of my calls is the claim resting on". Those are
 * different jobs, so they get different views.
 *
 * **This is a working view, not a reading one.** The tree of curved words is the viewer's, and it
 * is the right shape for reading a finished argument — one word per claim, laid over the piece.
 * It is the wrong shape for assigning: you cannot see which calls a segment holds, which calls
 * belong to nothing, or what a call's options actually say. So this is a table. Rows are
 * segments, in score order; each row lists the calls it holds and the MPM elements they wrote;
 * unassigned calls sit in their own list at the bottom, where they are impossible to miss.
 *
 * ## What "assigning" means, exactly
 *
 * A `Call` belongs to at most one `Segment`, by id. A call in no segment still runs — it still
 * writes its instruction — but it contributes no span, so nothing in the viewer can select it or
 * say why it is there. That is the state this desk exists to make visible and to fix.
 */
export interface SegmentsDeskProps extends ViewProps {
    segments: Segment[];
    setSegments: (next: Segment[]) => void;
    calls: readonly Call[];
}

export const SegmentsDesk = ({ mpm, segments, setSegments, calls }: SegmentsDeskProps) => {
    const { activeCallIds, setActiveCallIds, toggleActiveCall } = useCallSelection();
    const [filter, setFilter] = useState('');

    /** Element id ⇒ what kind of instruction it is, for labelling a segment's contents. */
    const typeById = useMemo(() => {
        const map = new Map<string, string>();
        for (const instruction of getInstructions(mpm)) {
            if (instruction.id !== undefined) map.set(instruction.id, instruction.type);
        }
        return map;
    }, [mpm]);

    const callById = useMemo(() => new Map(calls.map((call) => [call.id, call])), [calls]);

    const assigned = useMemo(
        () => new Set(segments.flatMap((segment) => segment.calls)),
        [segments],
    );
    const ungrouped = useMemo(
        () => calls.filter((call) => !assigned.has(call.id)),
        [calls, assigned],
    );

    /**
     * Segments in score order.
     *
     * By the earliest tick any of their elements sits at, not by their position in the file: the
     * file records them in the order they were made, and a reconstruction is worked on out of
     * order. A segment whose elements have all been overwritten sorts last rather than at zero.
     */
    const ordered = useMemo(() => {
        const earliest = (segment: Segment) => {
            // Off the calls' own ranges where they have one, and off their elements otherwise —
            // the two agree, and the range is the cheaper of them.
            const froms = segment.calls
                .map((id) => callById.get(id)?.range?.from)
                .filter((from): from is number => from !== undefined);
            if (froms.length) return Math.min(...froms);
            const dates = segment.calls
                .flatMap((id) => callById.get(id)?.elements ?? [])
                .map((id) => firstDateOf(id, typeById, mpm))
                .filter((date): date is number => date !== undefined);
            return dates.length ? Math.min(...dates) : Number.POSITIVE_INFINITY;
        };
        return [...segments]
            .map((segment) => ({ segment, at: earliest(segment) }))
            .sort((a, b) => a.at - b.at);
    }, [segments, typeById, mpm, callById]);

    const visible = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        if (!needle) return ordered;
        return ordered.filter(({ segment }) =>
            [segment.note, segment.commentary]
                .filter(Boolean)
                .some((field) => String(field).toLowerCase().includes(needle)),
        );
    }, [ordered, filter]);

    const patch = useCallback(
        (id: string, changes: Partial<Segment>) => {
            setSegments(
                segments.map((segment) =>
                    segment.id === id ? { ...segment, ...changes } : segment,
                ),
            );
        },
        [segments, setSegments],
    );

    /** Put the selected calls in a segment, taking them out of whatever holds them now. */
    const assignTo = useCallback(
        (segmentId: string, callIds: readonly string[]) => {
            if (!callIds.length) return;
            const moving = new Set(callIds);
            setSegments(
                segments.map((segment) => {
                    const without = segment.calls.filter((id) => !moving.has(id));
                    if (segment.id !== segmentId) return { ...segment, calls: without };
                    return { ...segment, calls: [...without, ...callIds] };
                }),
            );
        },
        [segments, setSegments],
    );

    const newSegment = useCallback(() => {
        const taking = [...activeCallIds];
        const moving = new Set(taking);
        const created: Segment = { id: v4(), calls: taking };
        setSegments([
            ...segments.map((segment) => ({
                ...segment,
                calls: segment.calls.filter((id) => !moving.has(id)),
            })),
            created,
        ]);
        setActiveCallIds(new Set());
    }, [activeCallIds, segments, setSegments, setActiveCallIds]);

    const dissolve = useCallback(
        (id: string) => {
            // The calls survive; only the grouping goes. They land in the ungrouped list, which
            // is the honest place for a call nobody is currently claiming anything about.
            setSegments(segments.filter((segment) => segment.id !== id));
        },
        [segments, setSegments],
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderBottom: '1px solid #e5e7eb',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: 12,
                }}
            >
                <input
                    value={filter}
                    onChange={(event) => {
                        setFilter(event.target.value);
                    }}
                    placeholder="Filter by word or commentary"
                    style={{
                        flex: '0 1 320px',
                        padding: '4px 8px',
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        fontSize: 12,
                    }}
                />
                <button
                    type="button"
                    onClick={newSegment}
                    disabled={activeCallIds.size === 0}
                    style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        padding: '4px 10px',
                        background: activeCallIds.size ? '#111827' : '#f3f4f6',
                        color: activeCallIds.size ? '#ffffff' : '#9ca3af',
                        cursor: activeCallIds.size ? 'pointer' : 'default',
                        fontSize: 12,
                    }}
                >
                    New segment from {activeCallIds.size} selected
                </button>
                <span style={{ marginLeft: 'auto', color: '#6b7280' }}>
                    {segments.length} segments · {calls.length} calls ·{' '}
                    <span style={{ color: ungrouped.length ? '#b45309' : '#6b7280' }}>
                        {ungrouped.length} ungrouped
                    </span>
                </span>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <table
                    style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontFamily: 'Inter, system-ui, sans-serif',
                        fontSize: 12,
                    }}
                >
                    <thead>
                        <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                            <th style={headCell}>Word</th>
                            <th style={headCell}>Calls</th>
                            <th style={headCell}>Wrote</th>
                            <th style={headCell} />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map(({ segment }) => (
                            <SegmentRow
                                key={segment.id}
                                segment={segment}
                                callById={callById}
                                typeById={typeById}
                                activeCallIds={activeCallIds}
                                onPatch={patch}
                                onToggleCall={toggleActiveCall}
                                onAssignSelected={() => {
                                    assignTo(segment.id, [...activeCallIds]);
                                }}
                                canAssign={activeCallIds.size > 0}
                                onDissolve={() => {
                                    dissolve(segment.id);
                                }}
                            />
                        ))}
                    </tbody>
                </table>

                <UngroupedCalls
                    calls={ungrouped}
                    activeCallIds={activeCallIds}
                    onToggleCall={toggleActiveCall}
                />
            </div>
        </div>
    );
};

const headCell: React.CSSProperties = {
    padding: '6px 10px',
    borderBottom: '1px solid #e5e7eb',
    fontWeight: 500,
    position: 'sticky',
    top: 0,
    background: '#ffffff',
};

/** The tick an element sits at, for sorting. `undefined` when it is no longer in the document. */
const firstDateOf = (
    elementId: string,
    typeById: ReadonlyMap<string, string>,
    mpm: Parameters<typeof getInstructions>[0],
): number | undefined => {
    if (!typeById.has(elementId)) return undefined;
    for (const instruction of getInstructions(mpm)) {
        if (instruction.id === elementId) return instruction.date;
    }
    return undefined;
};
