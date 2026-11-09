import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { Add, DeleteOutline } from "@mui/icons-material";
import type { ScopedTransformerViewProps } from "../TransformerViewProps";
import { InsertGraceNotes } from "../../fitting/transformers/ornamentation/InsertGraceNotes";
import type { AlignedGrace } from "../../fitting/alignment";
import { getInstructions } from "../../fitting/instructions/index";
import { DeskToolbar } from "../../components/DeskToolbar";
import { ToolGroup } from "../../components/toolbar/ToolGroup";
import { ToolbarButton } from "../../components/toolbar/ToolbarButton";
import { ToolStatus } from "../../components/toolbar/ToolStatus";
import { useCallSelection } from "../../hooks/CallSelection";
import { useEditable } from "../../hooks/Editing";
import { EVIDENCE_COLOUR } from "../evidence";
import { isCallOf } from "../../fitting/calls";
import { SilentOrnaments } from "../SilentOrnaments";

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** A MIDI pitch as a note name with its octave, C4 being 60. */
const nameOf = (pitch: number): string =>
    `${NAMES[((Math.round(pitch) % 12) + 12) % 12] ?? '?'}${String(Math.floor(Math.round(pitch) / 12) - 1)}`;

/** One grace group as the recording timed it, read off the alignment the chain left. */
interface GroupRow {
    group: string;
    date: number;
    principal: string;
    /** The group's grace notes and its principal, by `xml:id`: what evidence names. */
    ids: string[];
    tied: boolean;
    pitches: string;
    /** From the first grace note to the principal's strike, in ms; null without a strike to measure to. */
    lead: number | null;
    readings: number;
}

const rowsOf = (graces: readonly AlignedGrace[], principalOnset: (id: string) => number | undefined): GroupRow[] =>
    [...Map.groupBy(graces, (grace) => grace.group)].map(([group, rows]) => {
        const sorted = [...rows].sort((a, b) => a.slot - b.slot || a['milliseconds.date'] - b['milliseconds.date']);
        const first = sorted[0];
        const tied = sorted.find((row) => row.tied);
        const strike = tied?.['milliseconds.date'] ?? principalOnset(first?.principal ?? '');
        return {
            group,
            date: first?.date ?? 0,
            principal: first?.principal ?? '',
            ids: [...rows.map((row) => row['xml:id']), first?.principal ?? ''],
            tied: tied !== undefined,
            pitches: sorted.map((row) => nameOf(row['midi.pitch'])).join(' '),
            lead: first && strike !== undefined ? strike - first['milliseconds.date'] : null,
            readings: new Set(rows.map((row) => row.source ?? '')).size,
        };
    }).sort((a, b) => a.date - b.date);

/**
 * The score's grace notes, one row per group, with how far ahead of its principal the recording
 * played each. Insert writes the selected group as an MPM v3 ornament; Insert Default every group
 * in the scope.
 *
 * In the viewer there is no toolbar, and a click on a row only selects the call that wrote its
 * figure. The rows a selected call was fitted to are marked in the evidence colour, which for a
 * call over the whole scope is every row it covers.
 */
export const GraceNotesDesk = ({ msm, mpm, part, addTransformer }: ScopedTransformerViewProps<InsertGraceNotes>) => {
    const [selected, setSelected] = useState<string>()
    const { calls, activeElements, activeEvidence, setActiveElement, removeCall } = useCallSelection()
    const editable = useEditable()

    const defaultCall = calls
        .filter(isCallOf('InsertGraceNotes'))
        .find((call) => call.options.scope === part && call.options.group === undefined)

    const rows = useMemo(() => {
        const inScope = msm.graces.filter((grace) => part === 'global' || grace.part - 1 === part)
        // Where the principal sounded: an arpeggio fit has collapsed its chord, and remembers by how much.
        const onsetOf = (id: string) => {
            const note = msm.allNotes.find((candidate) => candidate['xml:id'] === id)
            return note === undefined ? undefined : note['milliseconds.date'] + (note.spread ?? 0)
        }
        return rowsOf(inScope, onsetOf)
    }, [msm, part])

    /** The figure each group was written as, by group, where it has been. */
    const written = useMemo(() => {
        const byPrincipal = new Map<string, string>()
        for (const ornament of getInstructions(mpm, 'ornament', part)) {
            const noteid = ornament.element.getAttributeValue('noteid')
            if (noteid !== null && ornament.id !== undefined) byPrincipal.set(noteid.replace(/^#/, ''), ornament.id)
        }
        return byPrincipal
    }, [mpm, part])

    return (
        <div>
            {editable && (
                <DeskToolbar>
                    <ToolGroup>
                        <ToolbarButton
                            primary
                            icon={<Add />}
                            label='Insert'
                            tooltip={selected === undefined
                                ? 'Select a group of grace notes in the table below'
                                : 'Write the selected group as an ornament on its principal'}
                            disabled={selected === undefined}
                            onClick={() => {
                                if (selected === undefined) return
                                addTransformer(new InsertGraceNotes({ scope: part, group: selected }))
                                setSelected(undefined)
                            }}
                        >
                            Insert
                        </ToolbarButton>
                        <ToolStatus width={120}>{selected ?? 'no group'}</ToolStatus>
                    </ToolGroup>
                    <ToolGroup label='Default'>
                        <ToolbarButton
                            icon={<Add />}
                            label='Insert Default'
                            tooltip={defaultCall
                                ? 'This scope already writes all of its grace notes'
                                : 'Write every group of grace notes in this scope'}
                            disabled={defaultCall !== undefined}
                            onClick={() => addTransformer(new InsertGraceNotes({ scope: part }))}
                        >
                            Insert Default
                        </ToolbarButton>
                        <ToolbarButton
                            icon={<DeleteOutline />}
                            label='Remove Default'
                            tooltip={defaultCall
                                ? 'Remove the call that writes every group in this scope'
                                : 'This scope has no default call for its grace notes'}
                            disabled={!defaultCall}
                            onClick={() => { if (defaultCall) removeCall(defaultCall.id) }}
                        >
                            Remove Default
                        </ToolbarButton>
                    </ToolGroup>
                    <ToolGroup>
                        <SilentOrnaments mpm={mpm} scope={part} />
                    </ToolGroup>
                </DeskToolbar>
            )}

            {rows.length === 0 ? (
                <Typography sx={{ m: 2 }} color="text.secondary">
                    The recording times no grace notes in this scope.
                </Typography>
            ) : (
                <Table size="small" sx={{ width: 'auto', m: 2 }}>
                    <TableHead>
                        <TableRow>
                            <TableCell>Group</TableCell>
                            <TableCell align="right">Tick</TableCell>
                            <TableCell>Grace notes</TableCell>
                            <TableCell>Principal</TableCell>
                            <TableCell align="right">Ahead by</TableCell>
                            <TableCell>Written as</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((row) => {
                            const ornament = written.get(row.principal)
                            const evidence = row.ids.some((id) => activeEvidence.has(id))
                            const clickable = editable || ornament !== undefined
                            return (
                                <TableRow
                                    key={row.group}
                                    hover={clickable}
                                    selected={selected === row.group || (ornament !== undefined && activeElements.includes(ornament))}
                                    onClick={() => {
                                        if (editable) setSelected(row.group)
                                        if (ornament) setActiveElement(ornament)
                                    }}
                                    data-evidence={evidence || undefined}
                                    sx={{
                                        cursor: clickable ? 'pointer' : 'default',
                                        ...(evidence && { boxShadow: `inset 3px 0 0 ${EVIDENCE_COLOUR}` }),
                                    }}
                                >
                                    <TableCell>{row.group}</TableCell>
                                    <TableCell align="right">{row.date}</TableCell>
                                    <TableCell sx={evidence ? { color: EVIDENCE_COLOUR, fontWeight: 600 } : undefined}>
                                        {row.pitches}
                                    </TableCell>
                                    <TableCell>{row.principal}{row.tied ? ' (tied)' : ''}</TableCell>
                                    <TableCell align="right">
                                        {row.readings > 1 ? 'choose a reading' : row.lead === null ? '–' : `${row.lead.toFixed(0)} ms`}
                                    </TableCell>
                                    <TableCell>{ornament ?? '–'}</TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            )}
        </div>
    )
}
