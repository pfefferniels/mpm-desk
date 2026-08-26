import { memo, useState } from 'react';

/** One MPM instruction, as the desk needs to show and select it. */
export interface Instruction {
    /** Its `xml:id` — `tempo_16560`, `sustain-36000_start`. */
    id: string;
    /** The MPM element type, for reading the id and for the title. */
    type: string;
    /** The call answerable for it. Selecting the instruction selects this. */
    call: string;
    /** The name that call was made under, for the title. */
    callName: string;
    /**
     * Whether a call under this claim is the one that *wrote* it, rather than one that reshaped
     * something written elsewhere.
     *
     * `Call.elements` is derived by diffing the document before and after the call runs, so it
     * credits reshaping as readily as writing — `StylizeOrnamentation` points all 100 ornaments
     * at shared `<ornamentDef>`s and is answerable for all 100. Drawn as an outline rather than
     * hidden: it is true that the claim touched them, and false that the claim is what put them
     * there.
     */
    written: boolean;
}

/** How many chips a claim shows before it starts counting instead. */
const SHOWN = 24;

interface InstructionChipsProps {
    instructions: readonly Instruction[];
    activeCallIds: ReadonlySet<string>;
    onToggleCall: (id: string) => void;
}

/**
 * A claim's instructions, one chip each — the handle for moving them between claims.
 *
 * **Clicking one selects the call that wrote it**, and so its siblings. That is not a compromise
 * hidden behind the chip: a call is the unit that writes a gesture — `InsertPedal` writes a press
 * as `_start` plus `_moveDown`, `InsertDynamicsInstructions` writes the two ends of one ramp —
 * and splitting one across two claims would be a claim about half a gesture. The chip is the
 * instruction because the instruction is what a reader recognises; the selection is the call
 * because the call is what can honestly move.
 */
export const InstructionChips = memo(
    ({ instructions, activeCallIds, onToggleCall }: InstructionChipsProps) => {
        const [all, setAll] = useState(false);

        if (!instructions.length)
            return <span style={{ color: '#b45309', fontSize: 11 }}>no instructions</span>;

        const shown = all ? instructions : instructions.slice(0, SHOWN);

        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 420 }}>
                {shown.map((instruction) => {
                    const on = activeCallIds.has(instruction.call);
                    const prefix = `${instruction.type}_`;
                    const rest = instruction.id.startsWith(prefix)
                        ? instruction.id.slice(prefix.length)
                        : null;
                    return (
                        <button
                            key={instruction.id}
                            type="button"
                            onClick={() => {
                                onToggleCall(instruction.call);
                            }}
                            title={
                                `${instruction.id} · ${instruction.type}\n` +
                                (instruction.written
                                    ? `written by ${instruction.callName}`
                                    : `reshaped by ${instruction.callName}; written under another claim`)
                            }
                            style={{
                                border: '1px solid',
                                borderColor: on ? '#111827' : '#e5e7eb',
                                background: on ? '#111827' : instruction.written ? '#ffffff' : 'transparent',
                                color: on ? '#ffffff' : instruction.written ? '#374151' : '#9ca3af',
                                borderStyle: instruction.written ? 'solid' : 'dashed',
                                borderRadius: 4,
                                padding: '1px 5px',
                                fontSize: 10,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {rest === null ? (
                                instruction.id
                            ) : (
                                <>
                                    <span style={{ opacity: 0.55 }}>{instruction.type}_</span>
                                    {rest}
                                </>
                            )}
                        </button>
                    );
                })}
                {!all && instructions.length > SHOWN && (
                    <button
                        type="button"
                        onClick={() => {
                            setAll(true);
                        }}
                        style={{
                            border: 'none',
                            background: 'none',
                            color: '#6b7280',
                            fontSize: 10,
                            cursor: 'pointer',
                            padding: '1px 3px',
                            textDecoration: 'underline',
                        }}
                    >
                        +{instructions.length - SHOWN} more
                    </button>
                )}
            </div>
        );
    },
);

InstructionChips.displayName = 'InstructionChips';
