import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Box, Slider, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { PlayArrow, Stop } from '@mui/icons-material';
import { DeskToolbar } from '../../components/DeskToolbar';
import { APP_BAR_HEIGHT } from '../../components/toolbar/EditorAppBar';
import { ToolGroup, ToolLabel } from '../../components/toolbar/ToolGroup';
import { ToolbarButton, ToolbarToggle } from '../../components/toolbar/ToolbarButton';
import type { DescriptionRun } from '../../fitting/description/client';
import { useCallSelection } from '../../hooks/CallSelection';
import { useEditable } from '../../hooks/Editing';
import { usePhysicalZoom } from '../../hooks/ZoomProvider';
import { useLatest } from '../../hooks/useLatest';
import { groundOf, notesOf, spellingOf } from './adapter';
import type { Asked } from './asking';
import type { Remark } from './document';
import { ExpertKey, KeyField } from './ExpertKey';
import { Match } from './Match';
import { Pen } from './Pen';
import type { DescribePlayback } from './playback';
import { RemarkCard } from './RemarkCard';
import { DescribeRoll, type DescribeRollProps } from './roll/DescribeRoll';
import { xOf } from './roll/geometry';
import { shown } from './roll/shapes';
import { aboutOf, endOf, notesOf as notesAbout, wholePiece } from './roll/strokes';
import type { About, RemarkState, RollRemark, RollView } from './roll/types';
import type { DescribeServices } from './services';
import type { Remarks } from './useRemarks';
import { askedFor, placeOf } from './words';

/** The pointer rests this long on a remark before it is played, and it plays on this long after the pointer has left. */
const DWELL_MS = 450;
const LINGER_MS = 200;

/** What Space is left to, wherever the focus is: as the editor's own binding has it. */
const TAKES_SPACE = 'button, summary, [role="button"], [role="combobox"], [role="listbox"], [role="slider"], [contenteditable="true"]';
/** What takes what is typed, so that typing there does not start a remark. */
const TAKES_TYPING = `input, textarea, select, ${TAKES_SPACE}`;

/** How a remark stands, for the roll to show. */
const stateOf = (remark: Remark, run: DescriptionRun | null, asked: Asked | undefined): RemarkState => {
    if (asked?.turn || asked?.answer) return 'pending';
    if (asked?.question) return 'question';
    if (asked?.failure) return 'trouble';
    const report = run?.remarks.find((told) => told.id === remark.id);
    if (report?.steps.some((step) => step.error !== undefined || step.withheld !== undefined)) return 'trouble';
    // Words that nothing has come of yet: kept, and not what the roll shows.
    return remark.steps.length === 0 && remark.model === null ? 'trouble' : 'done';
};

interface LiveRollProps extends Omit<DescribeRollProps, 'playheadMs'> {
    line: DescribePlayback['line'];
    playing: boolean;
}

/**
 * The roll with the line where the playing is.
 *
 * Apart from the desk so that the desk is not drawn again thirty times a second: the line is a
 * store, and only this follows it. The roll's layers hold still under a prop that is the line's
 * alone.
 *
 * While it plays, the roll is turned a page on when the line reaches its edge.
 */
const LiveRoll = ({ line, playing, ...roll }: LiveRollProps) => {
    const ms = useSyncExternalStore(line.subscribe, line.read);
    const pxPerSecond = usePhysicalZoom();
    const holder = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const scroller = holder.current?.querySelector('[data-layer="roll"]')?.parentElement;
        if (!playing || !scroller) return;
        const x = xOf(ms, pxPerSecond) - scroller.scrollLeft;
        if (x > scroller.clientWidth - 36 && x < scroller.clientWidth + 260) scroller.scrollLeft += x - 48;
    }, [ms, playing, pxPerSecond]);

    return (
        <div ref={holder} style={{ width: '100%', height: '100%' }}>
            <DescribeRoll {...roll} playheadMs={playing || ms > 0 ? ms : null} />
        </div>
    );
};

export interface DescribeSurfaceProps {
    /** The remarks, the run they come to, and what can be done with one; see `useRemarks`. */
    told: Remarks;
    /** Hearing the roll. */
    playback: DescribePlayback;
    /** The reader's own key, and how it is kept or forgotten. */
    expertKey: string | null;
    onExpertKey: (key: string | null) => void;
    services: Pick<DescribeServices, 'leftIn' | 'expertModel'>;
}

/**
 * The describe desk as the reader has it: the roll, the pen, a remark called up, and the hearing.
 *
 * A reader describes a recorded performance in their own words, on its piano roll, and never has
 * to know MPM. The roll shows the notes as the MPM so far renders them, each over its shadow, the
 * same note as it was played. A stroke or a click says what a remark is about, the pen says it,
 * and an expert turns it into steps of the fitting chain; the document is run again, and the
 * notes go to where it now has them.
 *
 * ## What is whose
 *
 * - **The document** holds the remarks: one `Describe` call each, with the calls it became after
 *   it. Every change to it is one edit (`document.ts`, `useRemarks`).
 * - **The session** (`asking.ts`) holds what is going on between a remark and the expert, which is
 *   not true of the document and has to outlast this component.
 * - **This component** holds what belongs to the reader's hand: what is being pointed at, what is
 *   being written, which remark is called up.
 *
 * What reaches outside the page is handed in as what it answered: the piano as `playback`, the
 * expert behind `told`. So this draws the same with all of it scripted.
 *
 * ## In the viewer
 *
 * The roll, the remarks and the hearing: a remark can be called up to read what it became, and
 * rested on to hear it brought out. Nothing is written or asked.
 */
export const DescribeSurface = ({ told, playback, expertKey, onExpertKey, services }: DescribeSurfaceProps) => {
    const editable = useEditable();
    const { focusCall } = useCallSelection();
    const { alignment, run, remarks, places, asked } = told;

    // -----------------------------------------------------------------------------------------
    // The roll
    // -----------------------------------------------------------------------------------------

    const [view, setView] = useState<RollView>({ staff: true, shadows: true, loudnessGain: 1 });
    /** What is in hand, and what has been written of it so far. */
    const [draft, setDraft] = useState<{ about: About; text: string } | null>(null);
    /** The remark called up. */
    const [open, setOpen] = useState<string | null>(null);
    const [hovered, setHovered] = useState<string | null>(null);

    const spelling = useMemo(() => spellingOf(alignment ?? { allNotes: [] }), [alignment]);
    const ground = useMemo(() => (run && alignment ? groundOf(run.roll, alignment) : null), [run, alignment]);
    const notes = useMemo(() => (run ? notesOf(run.roll, spelling, playback.moved) : []), [run, spelling, playback.moved]);
    const end = run?.roll.end ?? endOf(notes, ground?.bars ?? []);
    const bars = ground?.bars;

    const present = (id: string | null) => (id !== null && places.has(id) ? id : null);
    const called = present(open);
    const lit = called ?? present(hovered) ?? present(playback.brought);
    const evidence = useMemo(
        () => new Set(run?.remarks.find((report) => report.id === lit)?.steps.flatMap((step) => step.evidence) ?? []),
        [run, lit],
    );
    const rollRemarks = useMemo(
        () => remarks.map((remark): RollRemark => ({ id: remark.id, text: remark.text, about: remark.about, state: stateOf(remark, run, asked.get(remark.id)) })),
        [remarks, run, asked],
    );

    const latest = useLatest({ open, playback, draft });

    // -----------------------------------------------------------------------------------------
    // The reader's hand
    // -----------------------------------------------------------------------------------------

    const rest = (id: string | null) => {
        if (id !== null && playback.brought === id) playback.bring(null);
    };
    const close = () => {
        if (hovered !== open) rest(open);
        setOpen(null);
    };

    /** Notes taken in hand: alone, or with those already held. */
    const take = (ids: readonly string[], kind: Exclude<About['kind'], 'piece'>, additive: boolean, drop?: string) => {
        close();
        const held = draft && draft.about.kind !== 'piece' ? draft.about : null;
        const before = additive && held ? notesAbout(held, notes) : [];
        const wanted = new Set([...before, ...ids]);
        if (drop !== undefined) wanted.delete(drop);
        const picked = notes.filter((note) => wanted.has(note.id));
        // Two kinds of selection put together are a set of notes.
        const together = additive && held && held.kind !== kind ? 'notes' : kind;
        const text = draft?.text ?? '';
        if (picked.length === 0) setDraft(text.trim() === '' ? null : { about: wholePiece(end), text });
        else setDraft({ about: aboutOf(together, picked, notes, end), text });
    };

    const pick = (id: string, additive: boolean) => {
        const held = draft && draft.about.kind !== 'piece' ? notesAbout(draft.about, notes) : [];
        if (additive && held.includes(id)) take([], draft?.about.kind === 'piece' || !draft ? 'notes' : draft.about.kind, true, id);
        else take([id], 'notes', additive);
    };

    const stroke = (about: About, additive: boolean) => {
        if (about.kind === 'piece') {
            close();
            setDraft({ about, text: draft?.text ?? '' });
        } else if (additive) take(about.notes, about.kind, true);
        else {
            close();
            setDraft({ about, text: draft?.text ?? '' });
        }
    };

    /** A click on nothing: what is called up is put away, what is in hand let go, and the line set there. */
    const seek = (ms: number) => {
        if (called !== null) {
            close();
            return;
        }
        if (draft && draft.text.trim() !== '') {
            // What has been written is kept, and is now about the whole piece.
            setDraft({ about: wholePiece(end), text: draft.text });
            return;
        }
        setDraft(null);
        playback.seek(ms);
    };

    const describe = () => {
        const text = draft?.text.trim() ?? '';
        if (!draft || text === '') return;
        told.make(text, draft.about);
        setDraft(null);
    };

    const remove = (id: string) => {
        rest(id);
        setOpen(null);
        told.remove(id);
    };

    // Resting on a remark plays it brought out; leaving puts everything back, unless the remark
    // is the one called up.
    const dwell = useRef<ReturnType<typeof setTimeout>>(undefined);
    const hover = (id: string | null) => {
        setHovered(id);
        clearTimeout(dwell.current);
        if (id !== null) {
            if (draft || playback.brought === id) return;
            dwell.current = setTimeout(() => {
                const { playback: now, draft: writing } = latest.current;
                // Not while the roll itself plays: resting on a remark is not a way to interrupt it.
                if (!writing && !(now.playing && now.brought === null)) now.bring(id);
            }, DWELL_MS);
        } else {
            dwell.current = setTimeout(() => {
                const { playback: now, open: kept } = latest.current;
                if (now.brought !== null && now.brought !== kept) now.bring(null);
            }, LINGER_MS);
        }
    };
    useEffect(() => () => clearTimeout(dwell.current), []);

    const callUp = (id: string) => {
        setDraft(null);
        if (open === id) close();
        else {
            if (hovered !== open) rest(open);
            setOpen(id);
        }
    };

    // Space is the editor's key for playing the document's MPM. While this desk is open it plays
    // the roll instead, so it is taken before the editor's own binding hears it: both are bound
    // on the document, and that one is not to start as well.
    useHotkeys(
        'space',
        (event) => {
            event.stopPropagation();
            playback.toggle();
        },
        {
            preventDefault: true,
            eventListenerOptions: { capture: true },
            ignoreEventWhen: (event) => event.target instanceof Element && event.target.closest(TAKES_SPACE) !== null,
        },
        [playback.toggle],
    );
    useHotkeys(
        'escape',
        () => {
            if (called !== null) close();
            else setDraft(null);
        },
        [called, open, hovered, playback],
    );

    // With nothing in hand, what is typed is about the whole piece.
    const begin = useLatest((typed: string) => {
        close();
        setDraft({ about: wholePiece(end), text: typed });
    });
    useEffect(() => {
        if (!editable) return;
        const typed = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key.length !== 1 || event.key === ' ') return;
            if (event.target instanceof Element && event.target.closest(TAKES_TYPING)) return;
            const field = document.querySelector<HTMLTextAreaElement>('[data-pen] textarea');
            // A pen that is open takes the letter itself, once it has the focus.
            if (field) field.focus();
            else {
                event.preventDefault();
                begin.current(event.key);
            }
        };
        document.addEventListener('keydown', typed);
        return () => document.removeEventListener('keydown', typed);
    }, [editable, begin]);

    // -----------------------------------------------------------------------------------------
    // What is said under the roll
    // -----------------------------------------------------------------------------------------

    const read = [...asked].find(([, entry]) => entry.turn === 'asking')?.[0];
    const waiting = [...asked].filter(([, entry]) => entry.turn === 'waiting').length;
    const textOf = (id: string | null | undefined) => shown(remarks.find((remark) => remark.id === id)?.text ?? '');
    const status = !alignment
        ? 'No score is open.'
        : told.problem !== null
          ? told.problem
          : !run
            ? 'Laying out the roll…'
            : playback.pending
              ? 'Fetching the piano…'
              : playback.brought !== null && places.has(playback.brought)
                ? `Bringing out “${textOf(playback.brought)}”: what it wrote ×${playback.strength.toFixed(1)}, the rest held back.`
                : draft
                  ? `Writing about ${placeOf(draft.about, bars ?? [])}.`
                  : read !== undefined
                    ? `Reading “${textOf(read)}”${waiting > 0 ? `, ${String(waiting)} more waiting` : ''}. You can go on writing.`
                    : run.problems.length > 0
                      ? run.problems.join(' ')
                      : remarks.length === 0
                        ? editable
                            ? 'Nothing is described yet. Notes: what the MPM so far renders. Shadows: what was played. Drag to bracket a passage, click a note, or just type.'
                            : 'Nothing is described here. Notes: what the MPM renders. Shadows: what was played.'
                        : `Notes: what the MPM so far renders. Shadows: what was played. ${ground && ground.assumed.length > 0 ? 'Dashed bar lines: tempo only assumed. ' : ''}Click a remark to see what it became; rest on it to hear it brought out. Space plays.`;

    const now = useMemo(() => (run ? services.leftIn(run.roll.notes) : null), [run, services]);
    const was = useMemo(() => (told.bare ? services.leftIn(told.bare.roll.notes) : null), [told.bare, services]);

    const openRemark = called === null ? undefined : remarks.find((remark) => remark.id === called);
    const keyField = <KeyField held={expertKey} onChange={onExpertKey} model={services.expertModel} />;

    return (
        <Box data-describe-desk sx={{ display: 'flex', flexDirection: 'column', height: `calc(100dvh - ${String(APP_BAR_HEIGHT)}px)` }}>
            <DeskToolbar>
                <ToolGroup label="Hear">
                    <ToolbarButton
                        icon={playback.playing || playback.pending ? <Stop fontSize="small" /> : <PlayArrow fontSize="small" />}
                        label={playback.playing || playback.pending ? 'Stop the roll' : 'Play the roll'}
                        tooltip={playback.playing || playback.pending ? 'Stop (Space)' : 'Play from the line (Space)'}
                        disabled={!run}
                        onClick={playback.toggle}
                    />
                    <ToggleButtonGroup
                        exclusive
                        value={playback.hearing}
                        aria-label="What is heard"
                        // A click on the pressed one answers `null`, and there is no hearing nothing.
                        onChange={(_, hearing: DescribePlayback['hearing'] | null) => {
                            if (hearing !== null) playback.setHearing(hearing);
                        }}
                    >
                        <ToggleButton value="played">as played</ToggleButton>
                        <ToggleButton value="rendered">as the MPM</ToggleButton>
                    </ToggleButtonGroup>
                    <ToolLabel>bring out</ToolLabel>
                    <Slider
                        size="small"
                        min={1}
                        max={1.9}
                        step={0.1}
                        value={playback.strength}
                        onChange={(_, strength) => playback.setStrength(strength as number)}
                        // While it moves the notes go where the rendering now has them; let go,
                        // the remark it acts on is played again, to hear what was set.
                        onChangeCommitted={() => {
                            const acted = playback.brought ?? called;
                            if (acted !== null) playback.bring(acted);
                        }}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(strength) => `×${strength.toFixed(1)}`}
                        aria-label="How strongly a remark is brought out when the pointer rests on it"
                        sx={{ width: 72, mx: 0.5 }}
                    />
                </ToolGroup>
                <ToolGroup label="Roll">
                    <ToolbarToggle
                        selected={view.staff}
                        tooltip="Draw the notes on the two staves, by their spelling, or key by key"
                        label="Grand staff"
                        onChange={(staff) => setView((held) => ({ ...held, staff }))}
                    >
                        Staff
                    </ToolbarToggle>
                    <ToolbarToggle
                        selected={view.shadows}
                        tooltip="Behind each note, gray and dashed: the note as it was played"
                        label="Shadows of the notes as played"
                        onChange={(shadows) => setView((held) => ({ ...held, shadows }))}
                    >
                        Shadows
                    </ToolbarToggle>
                </ToolGroup>
                <ToolGroup label="Match">
                    <Match now={now} was={was} stale={told.stale} />
                </ToolGroup>
                {editable && (
                    <ToolGroup>
                        <ExpertKey held={expertKey} onChange={onExpertKey} model={services.expertModel} />
                    </ToolGroup>
                )}
            </DeskToolbar>

            <Box sx={{ flex: '1 1 auto', minHeight: 0 }}>
                {run && ground && (
                    <LiveRoll
                        line={playback.line}
                        playing={playback.playing}
                        notes={notes}
                        {...ground}
                        remarks={rollRemarks}
                        draft={editable ? (draft?.about ?? null) : null}
                        lit={lit}
                        evidence={evidence}
                        view={view}
                        editable={editable}
                        onPick={pick}
                        onStroke={stroke}
                        onRemark={callUp}
                        onHover={hover}
                        onSeek={seek}
                        pen={
                            editable && draft ? (
                                <Pen
                                    value={draft.text}
                                    onChange={(text) => setDraft({ about: draft.about, text })}
                                    placeholder={askedFor(draft.about, bars ?? [])}
                                    hint={
                                        told.canAsk
                                            ? 'Enter to say it · Esc to drop it'
                                            : 'Enter to keep it · Esc to drop it. Without a key it is not turned into steps'
                                    }
                                    onSend={describe}
                                    onDrop={() => setDraft(null)}
                                    grows={draft.about.kind === 'piece' ? 'down' : 'up'}
                                />
                            ) : undefined
                        }
                        popover={
                            openRemark ? (
                                <RemarkCard
                                    key={openRemark.id}
                                    remark={openRemark}
                                    place={placeOf(openRemark.about, bars ?? [])}
                                    report={run.remarks.find((report) => report.id === openRemark.id) ?? null}
                                    asked={asked.get(openRemark.id) ?? null}
                                    bars={bars ?? []}
                                    editable={editable}
                                    hasKey={told.canAsk}
                                    keyField={keyField}
                                    onReword={(text) => told.reword(openRemark.id, text)}
                                    onAsk={() => told.ask(openRemark.id)}
                                    onStop={() => told.stop(openRemark.id)}
                                    onDelete={() => remove(openRemark.id)}
                                    onReply={(answer) => told.reply(openRemark.id, answer)}
                                    onOpenCall={focusCall}
                                />
                            ) : undefined
                        }
                    />
                )}
            </Box>

            <Typography
                data-status
                variant="caption"
                color={told.problem !== null ? 'error' : 'text.secondary'}
                sx={{
                    flex: '0 0 auto',
                    px: 1.5,
                    py: 0.5,
                    borderTop: 1,
                    borderColor: 'divider',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                }}
            >
                {status}
            </Typography>
        </Box>
    );
};
