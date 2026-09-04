import { useCallback, useMemo, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Box, GlobalStyles, Menu, MenuItem, MenuList } from '@mui/material';
import type { ViewProps } from '../TransformerViewProps';
import { useScoreDocument } from '../../hooks/ScoreDocument';
import { useWorkDocument } from '../../hooks/WorkDocument';
import { voiceKey, voicesOf } from '../../fitting/voices';
import { Score } from '../../verovio/Score';
import { staffSpace } from '../../verovio/toolkit';
import { APP_BAR_HEIGHT } from '../../components/toolbar/EditorAppBar';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { ToolField } from '../../components/toolbar/ToolField';
import { paintParts, partStyles } from './paintParts';
import { colorForPart } from './partColors';
import { measureTicks, tickRange } from './measures';
import { PartsLegend } from './PartsLegend';
import { legendParts, type LegendPart } from './legendParts';
import { voiceLabel } from './voiceLabel';
import type { PartLayout, VoiceMove } from '../../fitting/transformers/voices/ProcessVoices';
import type { WorkVoices } from '../../model/workReducer';

/** What is selected for a move: notes picked in the score, or a voice over a stretch of bars. */
type Selection =
    | { kind: 'notes'; noteIDs: string[] }
    | { kind: 'range'; voice: string; from: number; to: number; noteIDs: string[] };

/**
 * Which MEI voice goes into which MSM part.
 *
 * MEI keeps the voices of a keyboard staff as sibling `<layer>`s and the conversion makes one part
 * per staff, so every voice of a hand arrives merged into one part sharing one MPM scope. This desk
 * is where that is decided otherwise: voices are combined into the parts a performance is actually
 * described in, the parts are named, and a note the engraving put in the wrong layer is moved.
 *
 * It writes to the one `ProcessVoices` call rather than adding one per gesture, so it dispatches
 * `setVoices` and never `addTransformer`. A layout is a state, not a sequence of clicks: the part
 * numbers it produces are what every other desk's `scope` names, and they cannot be allowed to
 * drift with the order somebody happened to press things in.
 */
export const VoicesDesk = ({ msm }: ViewProps) => {
    const { mei } = useScoreDocument();
    const { voices: layout, setVoices } = useWorkDocument();

    const [selection, setSelection] = useState<Selection | null>(null);
    const [selectedParts, setSelectedParts] = useState<ReadonlySet<number>>(new Set());
    const [isolated, setIsolated] = useState<number | undefined>(undefined);
    const [sourceVoice, setSourceVoice] = useState('');
    /** A whole voice, picked out of the legend so it can be sent to a part of its own. */
    const [pickedVoice, setPickedVoice] = useState<string | undefined>(undefined);
    const [fromBar, setFromBar] = useState('');
    const [toBar, setToBar] = useState('');
    /**
     * The node the move menu hangs off, held in state rather than in a ref.
     *
     * It is the button's own wrapper, not `document.activeElement`: a click that arrives without
     * focus leaves the active element as `<body>` and the menu then opens in the corner of the
     * window. And state rather than a ref because `anchorEl` is read during render, which is the
     * one thing a ref may not be — the same callback-ref-into-state `App` uses for the desk row.
     */
    const [moveButton, setMoveButton] = useState<HTMLElement | null>(null);
    const [moveOpen, setMoveOpen] = useState(false);

    const voices = useMemo(() => voicesOf(msm), [msm]);

    /** Note `xml:id` ⇒ part, as the chain resolved it. The colours are this map. */
    const partOf = useMemo(
        () => new Map(msm.allNotes.map((note) => [note['xml:id'], note.part])),
        [msm],
    );

    const dates = useMemo(
        () => new Map(msm.allNotes.map((note) => [note['xml:id'], note.date])),
        [msm],
    );

    const bars = useMemo(() => (mei ? measureTicks(mei, dates) : new Map<number, number>()), [mei, dates]);

    const parts = useMemo(
        () =>
            legendParts(
                msm,
                voices,
                new Map(layout.parts.map((part) => [part.number, part.name])),
            ),
        [msm, voices, layout.parts],
    );

    const selectedIds = useMemo(
        () => new Set(selection?.noteIDs ?? []),
        [selection],
    );

    // Stable identity, so `Score` repaints without re-engraving. It is what the layout effect
    // there re-runs on.
    const paint = useCallback(
        (root: HTMLElement) => {
            paintParts(root, partOf, selectedIds, isolated);
        },
        [partOf, selectedIds, isolated],
    );

    const onNoteClick = useCallback(
        (id: string, event: React.MouseEvent) => {
            // A grace note or a tie continuation is in no part, so there is no MSM note to move.
            if (!partOf.has(id)) return;

            setSelection((current) => {
                if (event.metaKey || event.ctrlKey) {
                    const ids = new Set(current?.noteIDs ?? []);
                    if (ids.has(id)) ids.delete(id);
                    else ids.add(id);
                    return { kind: 'notes', noteIDs: [...ids] };
                }
                return { kind: 'notes', noteIDs: [id] };
            });
        },
        [partOf],
    );

    const selectRange = () => {
        const range = tickRange(bars, Number(fromBar), Number(toBar));
        if (!range || !sourceVoice) return;

        const noteIDs = msm.allNotes
            .filter(
                (note) =>
                    voiceKey(note) === sourceVoice &&
                    note.date >= range.from &&
                    note.date < range.to,
            )
            .map((note) => note['xml:id']);

        setSelection({ kind: 'range', voice: sourceVoice, from: range.from, to: range.to, noteIDs });
    };

    const moveTo = (part: number) => {
        setMoveOpen(false);

        // A whole voice is a *layout* fact, so it is written into `parts` rather than appended as
        // a move. Recording it as a move instead would leave the layout saying the voice is still
        // where it was and rely on an override to contradict it — two statements about one thing,
        // and the legend would have to read both to say where the voice is.
        if (pickedVoice) {
            const moving = pickedVoice;
            setPickedVoice(undefined);
            setVoices((previous) => {
                const withoutIt = baseLayout(previous, parts).map((entry) => ({
                    ...entry,
                    voices: entry.voices.filter((key) => key !== moving),
                }));
                const placed = withoutIt.some((entry) => entry.number === part)
                    ? withoutIt.map((entry) =>
                          entry.number === part
                              ? { ...entry, voices: [...entry.voices, moving] }
                              : entry,
                      )
                    : [...withoutIt, { number: part, name: '', voices: [moving] }];
                return { ...previous, parts: tidy(placed, previous.moves) };
            });
            return;
        }

        if (!selection) return;
        setSelection(null);

        setVoices((previous) => {
            // The two selections record different things on purpose. A range keeps meaning what it
            // says after the notes under it are re-selected; a note list is what a click produced
            // and nothing more. Enumerating twenty bars of ids would record the same fact hundreds
            // of times.
            const move: VoiceMove =
                selection.kind === 'range'
                    ? {
                          part,
                          select: {
                              voice: selection.voice,
                              from: selection.from,
                              to: selection.to,
                          },
                      }
                    : { part, select: { noteIDs: selection.noteIDs } };

            // The destination joins the layout even though no voice is in it. A part is what the
            // layout says exists — it is where the name lives, and `ProcessVoices` reports a move
            // naming a part nothing declares — and a move to a new part declares nothing otherwise.
            const base = baseLayout(previous, parts);
            const placed = base.some((entry) => entry.number === part)
                ? base
                : [...base, { number: part, name: '', voices: [] }];
            const moves = [...previous.moves, move];

            return { ...previous, parts: tidy(placed, moves), moves };
        });
    };

    const combine = () => {
        const [target, ...rest] = [...selectedParts].sort((a, b) => a - b);
        if (target === undefined || rest.length === 0) return;

        const folded = new Set(rest);
        const voiceKeys = parts
            .filter((part) => part.number === target || folded.has(part.number))
            .flatMap((part) => part.voices.map((voice) => voice.key));

        setSelectedParts(new Set([target]));
        setVoices((previous) => {
            const kept = previous.parts.filter((part) => !folded.has(part.number));
            const placed = kept.some((part) => part.number === target)
                ? kept.map((part) =>
                      part.number === target ? { ...part, voices: voiceKeys } : part,
                  )
                : [...kept, { number: target, name: '', voices: voiceKeys }];
            // The moves are re-pointed, not left behind. A part a move filled holds notes no voice
            // as a whole belongs to, so folding its entry away would take its name and leave its
            // notes exactly where they were.
            const moves = previous.moves.map((move) =>
                folded.has(move.part) ? { ...move, part: target } : move,
            );

            return { ...previous, parts: tidy(placed, moves), moves };
        });
    };

    const rename = (part: number, name: string) => {
        setVoices((previous) => {
            const existing = previous.parts.find((entry) => entry.number === part);
            const voiceKeys = parts.find((entry) => entry.number === part)?.voices.map((v) => v.key) ?? [];
            return {
                ...previous,
                parts: existing
                    ? previous.parts.map((entry) =>
                          entry.number === part ? { ...entry, name } : entry,
                      )
                    : [...previous.parts, { number: part, name, voices: voiceKeys }].sort(
                          (a, b) => a.number - b.number,
                      ),
            };
        });
    };

    const selectPart = (part: number, additive: boolean) => {
        setSelectedParts((current) => {
            const next = new Set(additive ? current : []);
            if (next.has(part)) next.delete(part);
            else next.add(part);
            return next;
        });
    };

    const clear = useCallback(() => {
        setSelection(null);
        setPickedVoice(undefined);
        setSelectedParts(new Set());
    }, []);

    /**
     * Escape drops whatever is picked, wherever the pointer happens to be — the score has no
     * focusable element to hang a key handler on, so this is bound on the document.
     *
     * The library skips form tags by default, which is what leaves the legend's name field alone:
     * Escape there reverts the draft rather than clearing the selection under it. A menu answers
     * Escape first and stops the event, so closing the move menu does not also drop the selection
     * it was opened for.
     */
    useHotkeys('escape', clear, [clear]);

    /**
     * How many notes the move would take, or `undefined` while there is nothing to move.
     *
     * A picked voice is counted rather than named: the button is the one place the size of the
     * gesture is stated, and "a whole voice" says nothing about whether that is five notes or two
     * hundred.
     */
    const movingNotes = pickedVoice
        ? voices.find((voice) => voice.key === pickedVoice)?.notes
        : selection?.noteIDs.length;

    const moveLabel =
        movingNotes === undefined
            ? 'Move to…'
            : `Move ${String(movingNotes)} note${movingNotes === 1 ? '' : 's'}`;

    if (!mei) return null;

    return (
        <>
            <GlobalStyles styles={partStyles(staffSpace() * 0.15)} />

            <DeskToolbar>
                <ToolGroup label="Select">
                    <Box
                        component="select"
                        aria-label="Source voice"
                        value={sourceVoice}
                        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                            setSourceVoice(event.target.value);
                        }}
                        sx={{ height: 30, borderRadius: 1, border: '1px solid #e5e7eb' }}
                    >
                        <option value="">Voice…</option>
                        {voices.map((voice) => (
                            <option key={voice.key} value={voice.key}>
                                {voiceLabel(voice)}
                            </option>
                        ))}
                    </Box>
                    <ToolField label="Bars" type="number" width={64} value={fromBar} onChange={setFromBar} />
                    <ToolField label="to" type="number" width={64} value={toBar} onChange={setToBar} />
                    <ToolbarButton
                        tooltip={
                            sourceVoice && fromBar && toBar
                                ? 'Select that voice over those bars'
                                : 'Pick a voice and a range of bars first'
                        }
                        label="Select range"
                        disabled={!sourceVoice || !fromBar || !toBar}
                        onClick={selectRange}
                    >
                        Select
                    </ToolbarButton>
                </ToolGroup>

                <ToolGroup label="Edits">
                    {/* The menu hangs off this box rather than off the button: `ToolbarButton`
                        wraps its control in a tooltip span and forwards no ref. The width is held
                        so that a label counting the selection does not push Combine and Clear
                        sideways every time the selection changes. */}
                    <Box ref={setMoveButton} sx={{ display: 'inline-flex', minWidth: 148 }}>
                    <ToolbarButton
                        primary
                        tooltip={
                            pickedVoice
                                ? 'Move that whole voice into another part'
                                : selection
                                  ? 'Move the selected notes into another part'
                                  : 'Pick a voice in the list, or select notes in the score'
                        }
                        label={moveLabel}
                        disabled={!selection && !pickedVoice}
                        onClick={() => {
                            setMoveOpen(true);
                        }}
                    >
                        {moveLabel}
                    </ToolbarButton>
                    </Box>
                    <ToolbarButton
                        tooltip={
                            selectedParts.size > 1
                                ? 'Fold the selected parts into the first of them'
                                : 'Select two or more parts in the list on the right'
                        }
                        label="Combine"
                        disabled={selectedParts.size < 2}
                        onClick={combine}
                    >
                        Combine
                    </ToolbarButton>
                    <ToolbarButton
                        tooltip={selection ? 'Clear the selection (Esc)' : 'Nothing is selected'}
                        label="Clear"
                        disabled={!selection && !pickedVoice && selectedParts.size === 0}
                        onClick={clear}
                    >
                        Clear
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>

            <Menu
                open={moveOpen}
                anchorEl={moveButton}
                onClose={() => {
                    setMoveOpen(false);
                }}
            >
                <MenuList dense>
                    {parts.map((part) => (
                        <MenuItem
                            key={part.number}
                            onClick={() => {
                                moveTo(part.number);
                            }}
                        >
                            <Box
                                sx={{
                                    width: 12,
                                    height: 12,
                                    mr: 1,
                                    borderRadius: '2px',
                                    bgcolor: colorForPart(part.number),
                                }}
                            />
                            {part.name || `Part ${String(part.number)}`}
                        </MenuItem>
                    ))}
                    <MenuItem
                        onClick={() => {
                            moveTo(Math.max(0, ...parts.map((part) => part.number)) + 1);
                        }}
                    >
                        New part
                    </MenuItem>
                </MenuList>
            </Menu>

            <Box sx={{ display: 'flex', height: `calc(100vh - ${String(APP_BAR_HEIGHT)}px - 1rem)` }}>
                <Box sx={{ flexGrow: 1, overflow: 'auto', bgcolor: '#ffffff' }}>
                    <Score mei={mei} paint={paint} onNoteClick={onNoteClick} />
                </Box>
                <PartsLegend
                    parts={parts}
                    selected={selectedParts}
                    selectedVoice={pickedVoice}
                    onSelect={selectPart}
                    onSelectVoice={setPickedVoice}
                    onRename={rename}
                    onIsolate={setIsolated}
                />
            </Box>
        </>
    );
};

/**
 * The layout a chain with no `ProcessVoices` call is implicitly running.
 *
 * Written out the moment something edits it, because the transformer's `parts` are the whole
 * layout rather than an addition to it: a first edit that named only the part it touched would
 * silently drop every other voice into the part its options never mention.
 */
const asLayout = (parts: readonly LegendPart[]): PartLayout[] =>
    parts.map((part) => ({
        number: part.number,
        name: part.name,
        voices: part.voices.map((voice) => voice.key),
    }));

/** The layout an edit starts from: the one that is written, else the one being run implicitly. */
const baseLayout = (previous: WorkVoices, parts: readonly LegendPart[]): PartLayout[] =>
    previous.parts.length > 0 ? [...previous.parts] : asLayout(parts);

/**
 * The layout with the parts that hold nothing dropped, in order.
 *
 * A part left holding neither a voice nor a move is not a part, and dropping it is what keeps the
 * numbering dense — which `scope.ts` and `Alignment.build` both read. A move's destination stays:
 * it holds notes no voice as a whole belongs to, and it is where the name of that part lives.
 */
const tidy = (parts: readonly PartLayout[], moves: readonly VoiceMove[]): PartLayout[] => {
    const filled = new Set(moves.map((move) => move.part));
    return parts
        .filter((part) => part.voices.length > 0 || filled.has(part.number))
        .sort((a, b) => a.number - b.number);
};
