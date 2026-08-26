import { memo, useMemo } from 'react';
import type { Call } from '../../model/Work';

interface UngroupedCallsProps {
    calls: readonly Call[];
    activeCallIds: Set<string>;
    onToggleCall: (id: string) => void;
}

/**
 * The calls no segment holds.
 *
 * Deliberately at the bottom of the desk and impossible to miss, because this is the state the
 * desk exists to fix. A call in no segment still *runs* — it writes its instruction and the
 * performance sounds different for it — but it contributes no span, so nothing in the viewer can
 * select it or say why it is there. It is a decision with no argument attached, and this list is
 * the one place that says so.
 *
 * One is expected and permanent: the `InsertMetadata` the runner substitutes writes `<metadata>`
 * rather than an instruction, so there is nothing for a segment to claim. It is not shown here,
 * because it is not in the file's provenance at all.
 */
export const UngroupedCalls = memo(({ calls, activeCallIds, onToggleCall }: UngroupedCallsProps) => {
    const byName = useMemo(() => {
        const groups = new Map<string, Call[]>();
        for (const call of calls) {
            const existing = groups.get(call.name);
            if (existing) existing.push(call);
            else groups.set(call.name, [call]);
        }
        return [...groups].sort((a, b) => b[1].length - a[1].length);
    }, [calls]);

    if (!calls.length) return null;

    return (
        <div
            style={{
                borderTop: '2px solid #fcd34d',
                background: '#fffbeb',
                padding: '8px 12px',
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 12,
            }}
        >
            <div style={{ marginBottom: 6, color: '#92400e' }}>
                {calls.length} calls belong to no segment. They run, but nothing in the viewer can
                select them or say why they are there.
            </div>
            {byName.map(([name, group]) => (
                <div key={name} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'baseline' }}>
                    <span style={{ minWidth: 190, color: '#6b7280' }}>
                        {name} <span style={{ color: '#9ca3af' }}>×{group.length}</span>
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {group.map((call) => {
                            const on = activeCallIds.has(call.id);
                            const options = call.options as { from?: unknown; date?: unknown };
                            const at =
                                typeof options.from === 'number'
                                    ? options.from
                                    : typeof options.date === 'number'
                                      ? options.date
                                      : null;
                            return (
                                <button
                                    key={call.id}
                                    type="button"
                                    onClick={() => {
                                        onToggleCall(call.id);
                                    }}
                                    title={call.id}
                                    style={{
                                        border: '1px solid',
                                        borderColor: on ? '#111827' : '#fcd34d',
                                        background: on ? '#111827' : '#ffffff',
                                        color: on ? '#ffffff' : '#92400e',
                                        borderRadius: 4,
                                        padding: '1px 5px',
                                        fontSize: 10,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {at === null ? call.id.slice(0, 6) : `@${String(at)}`}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
});

UngroupedCalls.displayName = 'UngroupedCalls';
