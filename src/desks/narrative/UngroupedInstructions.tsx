import { memo, useMemo } from 'react';
import { InstructionChips, type Instruction } from './InstructionChips';

interface UngroupedInstructionsProps {
    instructions: readonly Instruction[];
    activeCallIds: ReadonlySet<string>;
    onToggleCall: (id: string) => void;
}

/**
 * The instructions no segment holds.
 *
 * Deliberately at the bottom of the desk and impossible to miss, because this is the state the
 * desk exists to fix. An ungrouped instruction still *sounds* — the call that wrote it still runs —
 * but it contributes no span, so nothing in the viewer can select it or say why it is there.
 * It is a decision with no argument attached, and this list is the one place that says so.
 *
 * **A call that wrote nothing never appears here**, because there is nothing of its to show.
 * `Modify` corrects the recording, `MakeChoice` picks between readings and `InsertMetadata`
 * writes `<metadata>`; none of them puts an instruction in the performance, so none of them is
 * something the narrative can be about. They are left out by having nothing rather than by
 * anyone keeping a list of which transformers count.
 */
export const UngroupedInstructions = memo(
    ({ instructions, activeCallIds, onToggleCall }: UngroupedInstructionsProps) => {
        const byName = useMemo(() => {
            const groups = new Map<string, Instruction[]>();
            for (const instruction of instructions) {
                const existing = groups.get(instruction.callName);
                if (existing) existing.push(instruction);
                else groups.set(instruction.callName, [instruction]);
            }
            return [...groups].sort((a, b) => b[1].length - a[1].length);
        }, [instructions]);

        if (!instructions.length) return null;

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
                    {instructions.length} instructions belong to no segment. They sound, but nothing
                    in the viewer can select them or say why they are there.
                </div>
                {byName.map(([name, group]) => (
                    <div
                        key={name}
                        style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'baseline' }}
                    >
                        <span style={{ minWidth: 190, color: '#6b7280' }}>
                            {name} <span style={{ color: '#9ca3af' }}>×{group.length}</span>
                        </span>
                        <InstructionChips
                            instructions={group}
                            activeCallIds={activeCallIds}
                            onToggleCall={onToggleCall}
                        />
                    </div>
                ))}
            </div>
        );
    },
);

UngroupedInstructions.displayName = 'UngroupedInstructions';
