import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Add } from '@mui/icons-material';
import { v4 } from 'uuid';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { ToolField } from '../../components/toolbar/ToolField';
import { ToolStatus } from '../../components/toolbar/ToolStatus';
import { getInstructions } from '../../fitting/instructions/index';
import { PULSES_PER_QUARTER } from '../../fitting/ppq';
import { useCallSelection } from '../../hooks/CallSelection';
import { useWorkDocument } from '../../hooks/WorkDocument';
import { usePlayback, type PlaybackNoteEvent } from '../../hooks/PlaybackProvider';
import { useLatest } from '../../hooks/useLatest';
import type { ViewProps } from '../TransformerViewProps';
import type { Segment } from '../../model/Work';
import { readPerformance } from '../../utils/mpm';
import { setsEqual } from '../../utils/utils';
import { pointSpanFallback, tickRange } from '../../segment-stack/StackModel';
import { elementOwners, segmentsSoundingAt } from '../../segment-stack/sounding';
import { SegmentRow } from './SegmentRow';
import type { Instruction } from './InstructionChips';
import { gatherInstructions } from './gather';
import { UngroupedInstructions } from './UngroupedInstructions';

/**
 * The narrative: grouping MPM instructions into claims, and saying what each claim says.
 *
 * A separate step, and a separate desk. The other desks answer "what did the performer do here";
 * this one answers "what am I claiming, and which of the performance is the claim about". Those
 * are different jobs, so they get different views.
 *
 * **This is a working view, not a reading one.** The tree of curved words is the viewer's, and it
 * is the right shape for reading a finished argument — one word per claim, laid over the piece.
 * It is the wrong shape for assigning: you cannot see which instructions a claim covers, which
 * belong to nothing, or what the document says at any of them. So this is a table. Rows are
 * claims, in score order; each row draws its gestures and lists the instructions they are made
 * of; ungrouped instructions sit in their own list at the bottom, impossible to miss.
 *
 * ## What is grouped, and what is stored
 *
 * What is grouped is instructions. What is stored is `Call.segment` — the calls name the claim,
 * not the other way round, so the link is written once and where it cannot go stale. Everything
 * this desk shows about a claim is read through that: claim → its calls → what they wrote.
 *
 * The consequence worth knowing is that **a call's instructions move together.** That is not a
 * limitation working around the storage; it is what a call is. `InsertPedal` writes a press as
 * `_start` plus `_moveDown` and `InsertDynamicsInstructions` writes the two ends of one ramp, and
 * a claim about half a ramp is not a claim anybody makes. Where a pedal genuinely divides, it is
 * already two calls.
 *
 * A call that writes no instruction — `Modify`, `MakeChoice`, `InsertMetadata` — appears nowhere
 * in this desk. It may carry a `segment` and it contributes nothing regardless, because what a
 * claim covers is built from instructions and it has none. That is the whole of "these are not
 * part of the narrative": they are left out by having nothing to show.
 *
 * ## Why the run is handed in twice over
 *
 * A row draws what its claim covers, and it draws it with the viewer's own component — so it
 * needs the run in the two shapes that component reads: {@link NarrativeDeskProps.projected},
 * which is the work file's claims projected onto the ticks their calls acted on, and a
 * `PerformanceReader` over the finished document, which is where a curve is sampled from and an
 * instruction quoted from. Both come out of the same fit as the `mpm` every desk gets; neither is
 * derivable from it alone, because a span's reach is reported by the call rather than written on
 * the instruction.
 *
 * ## Hearing it
 *
 * The desk follows the playhead the way the viewer's tree does, and by the same rule: a row is
 * lit while any instruction its claim holds is in effect (`segmentsSoundingAt`), and scrolled
 * into view as it lights. It follows on its own rather than through `FollowPlayback`, because
 * that follow *selects* the sounding calls — and here the selection is the grouping in progress,
 * which a passing playhead must not touch.
 *
 * Clicking a chip plays that one instruction, spotlit: everything else damped, over the stretch
 * the instruction itself is in effect (`reachOf`) — a `<tempo>` until the next tempo, a ramp's
 * end until the other end, an ornament for the notes it sits on. Not the claim's whole stretch,
 * which is what a click on the word in the viewer plays: the question here is what *this one*
 * does, on its way into or out of a claim.
 */
export const NarrativeDesk = ({ msm, mpm, projected, performanceXml }: ViewProps) => {
    // The document itself, rather than six more props. This desk edits the claims — it is the
    // only one whose subject is the argument rather than a dimension of the sound — and used to
    // say so by taking props no other desk took, which is what kept it out of the registry the
    // registry was for.
    const { segments, setSegments, groupCalls, dissolveSegment, calls } = useWorkDocument();
    const { activeCallIds, setActiveCallIds, toggleActiveCall } = useCallSelection();
    const { play, exaggeration, isPlaying, subscribeNoteEvents } = usePlayback();
    const [filter, setFilter] = useState('');

    /** The claims the playhead is inside — the viewer's spotlight, in a table. */
    const [playingSegmentIds, setPlayingSegmentIds] = useState<Set<string>>(new Set());
    /** The instruction a click is auditioning, and the row it was clicked in — `null` for an ungrouped one. */
    const [previewing, setPreviewing] = useState<{
        segmentId: string | null;
        instructionId: string;
    } | null>(null);

    /**
     * The document read the way the drawings read it, once per fit.
     *
     * Parsing the MPM again rather than reusing the `Mpm` every desk is handed: the reader
     * resolves styles, span ends and Bézier control points, and it is the thing the viewer's
     * component takes. It costs about ten milliseconds on a document of this size, and only
     * while this desk is open.
     */
    const performance = useMemo(
        () =>
            readPerformance(performanceXml, {
                ppq: PULSES_PER_QUARTER,
                signatures: msm.timeSignatures,
            }),
        [performanceXml, msm],
    );

    /** A claim acting on a single point still has to be drawn over something. */
    const minPointSpan = useMemo(() => pointSpanFallback([...projected]), [projected]);

    const gesturesById = useMemo(
        () => new Map(projected.map((segment) => [segment.id, segment])),
        [projected],
    );

    /** MPM element id ⇒ the claim that holds it, for following the playhead. */
    const owners = useMemo(() => elementOwners(projected), [projected]);

    const followPlayback = useEffectEvent(({ date, scoped }: PlaybackNoteEvent) => {
        // A clicked chip previews itself, and its row is lit for that reason already.
        if (scoped) return;
        setPreviewing(null);
        const sounding = segmentsSoundingAt(performance, date, owners);
        setPlayingSegmentIds((prev) => (setsEqual(prev, sounding) ? prev : sounding));
    });

    useEffect(() => subscribeNoteEvents(followPlayback), [subscribeNoteEvents]);

    // The spotlight goes out with the sound — the playhead's and the clicked chip's alike. A
    // preview stops itself once its stretch is through, and a row lit for nothing is a row lying.
    //
    // Adjusted during render off the last `isPlaying` seen, rather than in an effect: this is a
    // reset on a changed input and nothing outside React is being synchronised. An effect would
    // paint the rows still lit once after the sound had already stopped.
    const [wasPlaying, setWasPlaying] = useState(isPlaying);
    if (wasPlaying !== isPlaying) {
        setWasPlaying(isPlaying);
        if (!isPlaying) {
            setPlayingSegmentIds((prev) => (prev.size > 0 ? new Set() : prev));
            setPreviewing(null);
        }
    }

    const performanceRef = useLatest(performance);
    const playRef = useLatest(play);
    const exaggerationRef = useLatest(exaggeration);
    const minPointSpanRef = useLatest(minPointSpan);

    /**
     * Audition one instruction: its own reach of the piece, with everything else damped.
     *
     * Through refs, so the callback every row and chip is handed stays the same one across
     * fits and knob moves — the rows are memo'd on it.
     */
    const playInstruction = useCallback(
        (instruction: Instruction, segmentId: string | null) => {
            const reader = performanceRef.current;
            const read = reader.byId(instruction.id);
            playRef.current({
                mpmIds: [instruction.id],
                isolate: true,
                exaggerate: exaggerationRef.current,
                ...(read && { range: tickRange(reader.reachOf(read), minPointSpanRef.current) }),
            });
            // Whatever the playhead had lit belongs to the run this just replaced.
            setPlayingSegmentIds((prev) => (prev.size > 0 ? new Set() : prev));
            setPreviewing({ segmentId, instructionId: instruction.id });
        },
        [performanceRef, playRef, exaggerationRef, minPointSpanRef],
    );

    const playUngrouped = useCallback(
        (instruction: Instruction) => {
            playInstruction(instruction, null);
        },
        [playInstruction],
    );

    /** Element id ⇒ what kind of instruction it is; absent means the document no longer holds it. */
    const typeById = useMemo(() => {
        const map = new Map<string, string>();
        for (const instruction of getInstructions(mpm)) {
            if (instruction.id !== undefined) map.set(instruction.id, instruction.type);
        }
        return map;
    }, [mpm]);

    const { bySegment, ungrouped } = useMemo(
        () => gatherInstructions(segments, calls, typeById),
        [segments, calls, typeById],
    );

    const callById = useMemo(() => new Map(calls.map((call) => [call.id, call])), [calls]);

    /**
     * Claims in score order.
     *
     * By the earliest tick any of their calls acts at, not by their position in the file: the
     * file records them in the order they were made, and a reconstruction is worked on out of
     * order. A claim whose instructions have all been overwritten sorts last rather than at zero.
     */
    const ordered = useMemo(() => {
        const froms = new Map<string, number>();
        for (const call of calls) {
            if (call.segment === undefined || call.range === undefined) continue;
            const current = froms.get(call.segment);
            if (current === undefined || call.range.from < current)
                froms.set(call.segment, call.range.from);
        }
        return [...segments]
            .map((segment) => ({
                segment,
                at: froms.get(segment.id) ?? Number.POSITIVE_INFINITY,
            }))
            .sort((a, b) => a.at - b.at);
    }, [segments, calls]);

    const visible = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        if (!needle) return ordered;
        return ordered.filter(({ segment }) =>
            (segment.note ?? '').toLowerCase().includes(needle),
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

    const assignTo = useCallback(
        (segment: Segment) => {
            groupCalls([...activeCallIds], segment);
        },
        [activeCallIds, groupCalls],
    );

    const newSegment = useCallback(() => {
        groupCalls([...activeCallIds], { id: v4() });
        setActiveCallIds(new Set());
    }, [activeCallIds, groupCalls, setActiveCallIds]);

    /** How many instructions the selection stands for — a call moves everything it wrote. */
    const selectedInstructions = useMemo(
        () =>
            [...activeCallIds].reduce(
                (total, id) =>
                    total +
                    (callById.get(id)?.elements ?? []).filter((element) => typeById.has(element))
                        .length,
                0,
            ),
        [activeCallIds, callById, typeById],
    );

    const grouped = useMemo(
        () =>
            [...bySegment.values()].reduce((total, held) => total + held.instructions.length, 0),
        [bySegment],
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/*
                This desk's controls, in the app bar the other nine already share.

                It had its own header instead — a flex row with a `borderBottom`, a raw `<input>`
                and a hand-styled `<button>` whose disabled state was six colour literals — so
                the editor showed two bars stacked one above the other, the app's and this one's,
                spelling the same three ideas (a field, a primary action, a readout) in two
                different visual languages. Nothing about grouping instructions needs its own
                chrome; what it needed was a home in the shared one.
            */}
            <DeskToolbar>
                <ToolGroup>
                    <ToolbarButton
                        primary
                        icon={<Add />}
                        label='New Segment'
                        tooltip={
                            activeCallIds.size === 0
                                ? 'Select instructions in a row first — a claim is made out of them, and none are selected'
                                : `Group the ${selectedInstructions} selected ${selectedInstructions === 1 ? 'instruction' : 'instructions'} into a new claim`
                        }
                        disabled={activeCallIds.size === 0}
                        onClick={newSegment}
                    >
                        New Segment
                    </ToolbarButton>
                    {/*
                        Beside the button, not inside its label. It read `New segment from 12
                        selected`, and a label is what sizes a button — so it changed width on
                        every click on a chip, which is to say while the user was selecting
                        *for* it. `ToolStatus` holds a fixed slot in tabular figures instead, so
                        the button the cursor is travelling towards stays where it was.
                    */}
                    <ToolStatus width={96}>{`${selectedInstructions} selected`}</ToolStatus>
                </ToolGroup>

                {/*
                    Unlabelled, where the vocabulary would say `View`.

                    A group caption names what its controls act on, and this group's one control
                    already carries that name: side by side they rendered as `VIEW FILTER`, two
                    near-synonyms in the same ten-point capitals, which reads as one confused
                    label rather than as a category and a field. `TemporalSpreadDesk` keeps its
                    `View` because `Beat length` does not say by itself that it only redraws.
                */}
                <ToolGroup>
                    <ToolField
                        label='Filter'
                        value={filter}
                        onChange={setFilter}
                        placeholder='by word'
                        width={200}
                        clearable
                    />
                </ToolGroup>

                {/*
                    What the document is, at a glance — and it never moves.

                    Both readouts render whatever the counts are; only the *tone* of the second
                    one switches. The amber said "there is unfinished work here" by being the
                    only thing on the bar in `#b45309`, which is `warning.main` now — the same
                    token the app bar's fit indicator and the row's overwritten count use, so
                    the three finally mean one colour rather than three transcriptions of one.
                    Mounting it only when `ungrouped.length > 0` would have been the smaller
                    diff and the wrong one: the last instruction leaving the ungrouped list is
                    the moment the whole row would jump.

                    They stay in flow at the end of the bar rather than being pushed to its
                    right edge. `ToolGroup` takes no `sx`, and `ml: 'auto'` would be inert here
                    even if it did: the portal target in `EditorAppBar` is `flexShrink: 0` with
                    no `flexGrow`, so it is exactly as wide as its content and there is no free
                    space inside it for an auto margin to absorb. Pushing right is a decision
                    for the bar, not for a desk reaching into it.
                */}
                <ToolGroup>
                    <ToolStatus width={200}>
                        {`${segments.length} segments · ${grouped} instructions`}
                    </ToolStatus>
                    <ToolStatus width={96} tone={ungrouped.length ? 'warning' : 'default'}>
                        {`${ungrouped.length} ungrouped`}
                    </ToolStatus>
                </ToolGroup>
            </DeskToolbar>

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
                            <th style={headCell}>Gestures</th>
                            <th style={headCell}>Instructions</th>
                            <th style={headCell} />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map(({ segment }) => (
                            <SegmentRow
                                key={segment.id}
                                segment={segment}
                                gestures={gesturesById.get(segment.id)}
                                instructions={bySegment.get(segment.id)?.instructions ?? EMPTY}
                                overwritten={bySegment.get(segment.id)?.overwritten ?? 0}
                                performance={performance}
                                minPointSpan={minPointSpan}
                                activeCallIds={activeCallIds}
                                playing={
                                    playingSegmentIds.has(segment.id) ||
                                    previewing?.segmentId === segment.id
                                }
                                playingInstructionId={
                                    previewing?.segmentId === segment.id
                                        ? previewing.instructionId
                                        : null
                                }
                                onPatch={patch}
                                onToggleCall={toggleActiveCall}
                                onPlayInstruction={playInstruction}
                                onAssignSelected={() => {
                                    assignTo(segment);
                                }}
                                canAssign={activeCallIds.size > 0}
                                onDissolve={() => {
                                    dissolveSegment(segment.id);
                                }}
                            />
                        ))}
                    </tbody>
                </table>

                <UngroupedInstructions
                    instructions={ungrouped}
                    activeCallIds={activeCallIds}
                    onToggleCall={toggleActiveCall}
                    onPlayInstruction={playUngrouped}
                    playingInstructionId={
                        previewing?.segmentId === null ? previewing.instructionId : null
                    }
                />
            </div>
        </div>
    );
};

const EMPTY: readonly Instruction[] = [];

const headCell: React.CSSProperties = {
    padding: '6px 10px',
    borderBottom: '1px solid #e5e7eb',
    fontWeight: 500,
    position: 'sticky',
    top: 0,
    background: '#ffffff',
};
