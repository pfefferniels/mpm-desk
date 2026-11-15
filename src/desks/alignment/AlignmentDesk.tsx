import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, GlobalStyles, Slider, Stack, Typography } from '@mui/material';
import { NavigateBefore, NavigateNext } from '@mui/icons-material';
import { applyAlignment } from '../../alignment/applyAlignment';
import { divergencesOf, type Divergence } from '../../alignment/divergences';
import { MismatchedPairError, hasRepeatSigns, toMatches } from '../../alignment/mlign';
import { DEFAULT_MODEL } from '../../alignment/mlign/models';
import { recordedAlignment, type RecordedAlignment } from '../../alignment/recorded';
import { actionFor, notationOf, type Resolution } from '../../alignment/readings';
import {
    transcribe,
    untranscribed,
    writtenIdOf,
    type Notation,
    type NoteEdit,
    type Outcome,
} from '../../alignment/transcription';
import { ornamentSignsOf } from '../../mei/ornamentSigns';
import { parseRecordings } from '../../mei/parseRecordings';
import type { PlayablePedal } from '../../performance/buildMidiFile';
import { asSpans } from '../../performance/midiSpans';
import type { ScoreNote } from '../../score/scoreNotes';
import { Score } from '../../verovio/Score';
import { DEFAULT_PERFORMANCE_SCALE, performedOptions } from '../../verovio/toolkit';
import { EXTRA_COLOUR } from '../../verovio/extraNotes';
import { OMITTED_COLOUR } from '../../verovio/omissionMarks';
import { useScoreDocument } from '../../hooks/ScoreDocument';
import { usePerformances } from '../../hooks/Performances';
import { useWorkDocument } from '../../hooks/WorkDocument';
import type { WorkAlignment } from '../../model/workReducer';
import { APP_BAR_HEIGHT } from '../../components/toolbar/EditorAppBar';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { ToolField } from '../../components/toolbar/ToolField';
import { AlterationEditor } from './AlterationEditor';
import { Legend } from './Legend';
import { PlaybackBar } from './PlaybackBar';
import { REPLACED_COLOUR, alignmentStyles, paintAlignment, paintingOf } from './paintAlignment';
import { marksOf } from './marks';
import { readScore, runAlignment, type AlignmentRun, type Status } from './runAlignment';
import { useRecordingPlayback } from './useRecordingPlayback';

/**
 * The score as it was played.
 *
 * The desk that comes before every other one. Until the score and the recording have been put
 * note against note there is no recording to fit to, only an engraving and a MIDI file that
 * nothing relates.
 *
 * ## One press, and the score is the performance's
 *
 * Align runs the model and then transcribes, without asking: every note the performer added is
 * given a place in the bar, a length, a name and a staff and written into the score; every note
 * left out is taken out of it; every note played at another pitch is written at the pitch it
 * was played at. All of it goes into `<app>` readings beside the source, so nothing of the
 * source is lost. See `src/alignment/transcription`.
 *
 * What is left for a reader is to look, and three colours say what there is to look at: green
 * for what was added, red for what was left out, violet for what was changed. Clicking a
 * coloured note says how it was written and offers the other ways of writing it, grace notes
 * for a figure too quick to be measured, an ornament sign for one that is conventional, nothing
 * at all for a slip. That is a correction of a score that already exists, which is a different
 * thing from being asked sixty questions before there is one.
 *
 * ## What it writes, and where
 *
 * The matching goes into the MEI, as the `<performance>` of the As Played By customization: a
 * `<recording>` per take of `<when>` elements saying which note sounded when, how loudly and for
 * how long. That is the interchange format, what verovio lays the performed score out from, and
 * what `asMSM` reads to build the alignment the chain folds over. So this desk rewrites the MEI,
 * the one desk that does, and `ScoreDocument` says why.
 *
 * What the *reader* decides goes into the work file, on an `AlignSource` call per take, and only
 * where they decided something: a divergence nobody has touched has no entry and is written
 * however the transcriber reads it.
 *
 * ## The document is always derived
 *
 * The transcription is a function of the source score, the alignment and the reader's choices.
 * So nothing here patches a transcribed document: it is taken back to its source, which
 * `untranscribed` does exactly, and transcribed again. That is what makes a change of mind
 * cheap, and what lets a reopened project be reviewed without running the model.
 *
 * One take's alterations are in the score at a time. A document may hold several recordings,
 * but `<rdg source="performance">` is one reading, and writing a second take's into it takes
 * the first one's out. The first take keeps its matching; its added notes go back to being
 * notes the score does not write.
 */

const EMPTY_RESOLUTIONS: ReadonlyMap<string, Resolution> = new Map();
const EMPTY_OUTCOMES: ReadonlyMap<string, Outcome> = new Map();
const EMPTY_EDITS: ReadonlyMap<string, NoteEdit> = new Map();

/** What a transcription is, as far as telling two apart goes: the notes it wrote and took out. */
const signatureOf = (mei: string): string =>
    [...mei.matchAll(/<app[^>]*type="transcription"[^>]*>|xml:id="played-[^"]*"|type="transcribed"/g)]
        .map((found) => found[0])
        .sort()
        .join('|');

/** How many notes were added, left out and changed, which is what the legend counts. */
const countsOf = (divergences: readonly Divergence[], outcomes: ReadonlyMap<string, Outcome>) => {
    const counts = { added: 0, omitted: 0, changed: 0, total: 0 };
    for (const divergence of divergences) {
        const outcome = outcomes.get(divergence.id);
        if (!outcome) continue;
        counts.total++;
        if (divergence.kind === 'added') counts.added += outcome.noteIds.length;
        else if (divergence.kind === 'missing' && outcome.written === 'omitted') {
            counts.omitted += divergence.scoreIds.length;
        } else if (divergence.kind === 'replaced' && outcome.written === 'variant') counts.changed++;
    }
    return counts;
};


export const AlignmentDesk = () => {
    const { mei, setMei } = useScoreDocument();
    const { performances, openPerformance } = usePerformances();
    const { alignments, setAlignment } = useWorkDocument();
    const midiInput = useRef<HTMLInputElement>(null);

    /** The take under review. The first there is, until somebody picks another. */
    const [picked, setPicked] = useState<string>();
    const [scale, setScale] = useState(DEFAULT_PERFORMANCE_SCALE);

    /** This session's run, until it is written. Absent means: show what the document holds. */
    const [run, setRun] = useState<AlignmentRun>();
    const [status, setStatus] = useState<Status>();
    const [error, setError] = useState<string>();
    /** The two files do not look like the same music; the reader may insist. */
    const [mismatch, setMismatch] = useState<string>();
    const [notices, setNotices] = useState<string[]>([]);

    /** The notes of the score, which both a fresh run and a re-read alignment are grouped over. */
    const [scoreNotes, setScoreNotes] = useState<ScoreNote[]>([]);

    /** The alteration the reader has opened, and the mark they opened it on. */
    const [selected, setSelected] = useState<string>();
    /** The written-in note of it they clicked, which is the one the editor's hands are on. */
    const [selectedNote, setSelectedNote] = useState<string>();
    const [anchor, setAnchor] = useState<Element>();
    const [root, setRoot] = useState<HTMLDivElement | null>(null);

    /**
     * The score as its source has it: every reading the transcriber wrote taken out again.
     *
     * Everything below starts here rather than from the document, because the document may
     * already hold a transcription and a transcription is never built on another.
     */
    const source = useMemo(() => (mei ? untranscribed(mei) : undefined), [mei]);

    /**
     * Every take there is to review.
     *
     * Three sources of one answer, and the third is the one that must not be left out: the MEI is
     * where an alignment *lives*, so a score that arrives already aligned — by an earlier session,
     * by another tool, by the file somebody was sent — holds takes that no `AlignSource` call and no
     * open MIDI file mentions. Reading only the other two showed such a document as having nothing
     * to look at.
     */
    const takes = useMemo(() => {
        const inScore = source
            ? parseRecordings(source).recordings.map((entry) => entry.source)
            : [];
        return [
            ...new Set([
                ...inScore,
                ...performances.map((performance) => performance.source),
                ...alignments.map((alignment) => alignment.source),
            ]),
        ];
    }, [source, performances, alignments]);

    const take = picked && takes.includes(picked) ? picked : takes[0];
    const performance = performances.find((entry) => entry.source === take);
    const recorded = alignments.find((entry) => entry.source === take);

    const resolutions = recorded?.resolutions ?? EMPTY_RESOLUTIONS;
    const edits = recorded?.edits ?? EMPTY_EDITS;
    const resp = recorded?.resp ?? '';

    useEffect(() => {
        if (!source) return;
        let live = true;
        readScore(source)
            .then((notes) => {
                if (live) setScoreNotes(notes);
            })
            .catch((reason: unknown) => {
                if (live) setError(reason instanceof Error ? reason.message : String(reason));
            });
        return () => {
            live = false;
        };
    }, [source]);

    /** The alignment the document holds for this take, where it holds one. */
    const committed = useMemo((): RecordedAlignment | undefined => {
        if (!source || !take) return undefined;
        const info = parseRecordings(source).recordings.find((entry) => entry.source === take);
        return info ? recordedAlignment(info) : undefined;
    }, [source, take]);

    /** A fresh run stands in front of what the document holds, until it is written. */
    const alignment: RecordedAlignment | undefined = useMemo(() => {
        if (!run) return committed;
        return { ...run.result, spans: run.spans };
    }, [run, committed]);

    const signs = useMemo(() => (source ? ornamentSignsOf(source) : new Map()), [source]);
    const hasRepeats = useMemo(() => (source ? hasRepeatSigns(source) : false), [source]);

    const divergences = useMemo((): Divergence[] => {
        if (!alignment || scoreNotes.length === 0) return [];
        return divergencesOf(
            {
                matches: alignment.matches,
                deletions: alignment.deletions,
                insertions: alignment.insertions,
                scoreNotes,
                spans: alignment.spans,
                signs,
            },
            { hasRepeats },
        );
    }, [alignment, scoreNotes, signs, hasRepeats]);

    /**
     * The source with the matching in it, which is what the transcriber reads.
     *
     * For a fresh run that is the run written out; otherwise the document already is one.
     */
    const aligned = useMemo(() => {
        if (!source || !take) return undefined;
        if (!run || !performance) return { mei: source };

        const pairs = toMatches(run.result.matches).filter(
            (pair) => !run.hidden.has(pair.score_id),
        );
        try {
            return {
                mei: applyAlignment(source, performance.midi, pairs, {
                    source: take,
                    divergences,
                    // The reading only. What is to be *done* about it is the transcriber's
                    // business, and it reads that from the choices below.
                    resolutions: new Map(
                        [...resolutions].map(([id, { reading }]) => [id, { reading }]),
                    ),
                }),
            };
        } catch (reason: unknown) {
            // This runs while rendering, where a throw takes the desk down with it
            return {
                mei: undefined,
                failed: `The alignment could not be written into the score. ${
                    reason instanceof Error ? reason.message : String(reason)
                }`,
            };
        }
    }, [source, take, run, performance, divergences, resolutions]);

    /**
     * The transcription, twice over.
     *
     * `written` is the document: what Write puts into the score. `shown` is the same with the
     * notes the performer left out still standing, in red, because a note that has been taken
     * out cannot be seen to have been taken out. The page shows more than the document holds,
     * and what it shows beyond it is exactly the red.
     */
    const transcription = useMemo(() => {
        if (!aligned?.mei || !take || !alignment || divergences.length === 0) return undefined;

        const choices = new Map<string, Notation>();
        for (const divergence of divergences) {
            const action = resolutions.get(divergence.id)?.action;
            if (action) choices.set(divergence.id, notationOf(action));
        }
        const standing = new Map(choices);
        for (const divergence of divergences) {
            if (divergence.kind === 'missing') standing.set(divergence.id, 'none');
        }

        try {
            const input = {
                mei: aligned.mei,
                source: take,
                divergences,
                spans: alignment.spans,
                edits,
                resp: resp || undefined,
            };
            const written = transcribe({ ...input, choices });
            const shown = transcribe({ ...input, choices: standing });
            return {
                written: written.mei,
                shown: shown.mei,
                outcomes: written.outcomes,
                readings: written.readings,
            };
        } catch (reason: unknown) {
            return {
                failed: `The differences could not be written into the score. ${
                    reason instanceof Error ? reason.message : String(reason)
                }`,
            };
        }
    }, [aligned, take, alignment, divergences, resolutions, edits, resp]);

    const outcomes = transcription?.outcomes ?? EMPTY_OUTCOMES;
    const shown = transcription?.shown ?? aligned?.mei;
    const failed = aligned?.failed ?? transcription?.failed;

    const marks = useMemo(
        () => marksOf(divergences, alignment?.spans ?? [], outcomes),
        [divergences, alignment, outcomes],
    );

    const painting = useMemo(
        () =>
            paintingOf({
                matches: alignment?.matches ?? [],
                deletions: alignment?.deletions ?? [],
                divergences,
                minConfidence: 0,
                hidden: run?.hidden ?? new Set(),
                outcomes,
            }),
        [alignment, divergences, run, outcomes],
    );

    const paint = useCallback(
        (element: HTMLElement) => {
            paintAlignment(element, painting, selected);

            // A cross is drawn afresh on every repaint, so the one the card was opened on may
            // no longer be in the document. The card belongs to the alteration, not to a node:
            // it moves to whichever mark stands for it now.
            if (!selected) return;
            const escape = (id: string) => (typeof CSS?.escape === 'function' ? CSS.escape(id) : id);
            const mark =
                (selectedNote && element.querySelector(`[data-id="${escape(selectedNote)}"]`)) ||
                element.querySelector(`[data-divergence="${escape(selected)}"]:not([data-omitted])`);
            setAnchor((current) => (current?.isConnected ? current : mark ?? undefined));
        },
        [painting, selected, selectedNote],
    );

    /**
     * The bar in the editor, coloured as the page is, with the note in hand ringed.
     *
     * Not turned blue as the selection on the page is: in the bar the colour is what says what
     * the note is, and the bar holds nothing but the notes being asked about.
     */
    const paintBar = useCallback(
        (element: HTMLElement) => {
            paintAlignment(element, painting, undefined);
            for (const ringed of element.querySelectorAll('.alignment-editing')) {
                ringed.classList.remove('alignment-editing');
            }
            if (!selectedNote) return;
            const escaped = typeof CSS?.escape === 'function' ? CSS.escape(selectedNote) : selectedNote;
            element.querySelector(`[data-id="${escaped}"]`)?.classList.add('alignment-editing');
        },
        [painting, selectedNote],
    );

    const options = useMemo(
        () => ({
            ...performedOptions,
            performanceScale: scale,
            performanceRecording: take ?? '',
        }),
        [scale, take],
    );

    const pedals = useMemo<PlayablePedal[]>(() => {
        if (!performance) return [];
        return asSpans(performance.midi, true).flatMap((span) =>
            span.type === 'note'
                ? []
                : [
                      {
                          type: span.type,
                          onsetMs: span.onsetMs,
                          durationMs: span.offsetMs - span.onsetMs,
                          travel: span.travel,
                      },
                  ],
        );
    }, [performance]);

    /**
     * The note on the page each played note is: the written note it was matched to, or the note
     * the transcriber wrote for it.
     */
    const pageNoteOf = useMemo(() => {
        const notes = new Map((alignment?.matches ?? []).map((m) => [m.performanceId, m.scoreId]));
        const inScore = new Map(
            [...outcomes.values()].flatMap((outcome) =>
                outcome.notes.map((note) => [note.played, note.id] as const),
            ),
        );
        for (const span of alignment?.spans ?? []) {
            const id = inScore.get(writtenIdOf(span));
            if (id) notes.set(span.id, id);
        }
        return notes;
    }, [alignment, outcomes]);

    /**
     * What to light up while a played note sounds.
     *
     * The ids in the stream are the *performed* notes' own, because the performance is what is
     * playing. A note that is on the page lights there; one that is not lights the cross drawn
     * where it was played, which is the only mark on the page that is it.
     */
    const elementFor = useCallback(
        (performanceId: string) => {
            if (!root) return null;
            const escaped = (id: string) =>
                typeof CSS?.escape === 'function' ? CSS.escape(id) : id;
            const noteId = pageNoteOf.get(performanceId);
            return noteId
                ? root.querySelector(`[data-id="${escaped(noteId)}"]`)
                : root.querySelector(`[data-perf-id="${escaped(performanceId)}"]`);
        },
        [root, pageNoteOf],
    );

    const playback = useRecordingPlayback({
        notes: alignment?.spans ?? [],
        pedals,
        elementFor,
    });

    const align = useCallback(
        async (allowMismatch = false) => {
            if (!source || !performance || !take) return;

            setError(undefined);
            setMismatch(undefined);
            setSelected(undefined);
            setAnchor(undefined);

            try {
                const fresh = await runAlignment({
                    mei: source,
                    midi: performance.midi,
                    model: DEFAULT_MODEL,
                    allowMismatch,
                    onStatus: setStatus,
                });
                setRun(fresh);
                setScoreNotes(fresh.scoreNotes);
                setNotices(fresh.notices);
                setSelectedNote(undefined);

                // The settings the run was made with, recorded as soon as it has been made: a
                // decision taken about it in the next minute has to have somewhere to go.
                setAlignment({
                    source: take,
                    midi: performance.name,
                    model: DEFAULT_MODEL,
                    minConfidence: 0,
                    resolutions,
                    edits,
                    resp,
                    certainty: recorded?.certainty ?? 'medium',
                });
            } catch (reason: unknown) {
                if (reason instanceof MismatchedPairError) {
                    // Not a failure the reader can do nothing about: it is a judgement, and they
                    // are allowed to overrule it
                    setMismatch(reason.message);
                } else {
                    setError(reason instanceof Error ? reason.message : String(reason));
                }
            } finally {
                setStatus(undefined);
            }
        },
        [source, performance, take, resolutions, edits, resp, recorded, setAlignment],
    );

    /**
     * Whether the page shows something the document does not hold yet.
     *
     * Asked of the notes rather than of the text: the same transcription serialises with its
     * attributes in another order after a round trip, and a button that lit up for that would
     * offer to save nothing.
     */
    const unwritten = useMemo(() => {
        if (run) return true;
        if (!mei || !transcription?.written) return false;
        return signatureOf(transcription.written) !== signatureOf(mei);
    }, [run, mei, transcription]);

    /**
     * The record the reader's decisions go on: the one the work file has for this take, or a new
     * one where it has none.
     *
     * A score can arrive aligned, by another tool or from a file somebody was sent, and then
     * there is a `<recording>` and no `AlignSource` call. A reader of that document can still change
     * their mind about a note, and the first time they do is when the record is made.
     */
    const record = useMemo((): WorkAlignment | undefined => {
        if (recorded) return recorded;
        if (!take) return undefined;
        return {
            source: take,
            midi: performance?.name ?? '',
            model: DEFAULT_MODEL,
            minConfidence: 0,
            resolutions: EMPTY_RESOLUTIONS,
            edits: EMPTY_EDITS,
            resp: '',
            certainty: 'medium',
        };
    }, [recorded, take, performance]);

    /**
     * Put what is on the page into the document, and say on the take's call what was written.
     *
     * The score gets the readings; the `AlignSource` call gets their names. A published
     * reconstruction then says, without anything being run, which readings of its score came
     * of aligning it with this recording, beside what was decided on the way.
     */
    const write = useCallback(() => {
        const next = transcription?.written ?? aligned?.mei;
        if (!next) return;
        setMei(next);
        if (record) setAlignment(record, transcription?.readings ?? []);
        setRun(undefined);
        setNotices([]);
    }, [transcription, aligned, setMei, record, setAlignment]);

    const choose = useCallback(
        (divergence: Divergence, notation: Notation) => {
            if (!record) return;
            setAlignment({
                ...record,
                resolutions: new Map([
                    ...record.resolutions,
                    [
                        divergence.id,
                        { reading: divergence.reading, action: actionFor(divergence, notation) },
                    ],
                ]),
            });
        },
        [record, setAlignment],
    );

    /** Change one thing about one written-in note: where it stands, how long, on which staff. */
    const edit = useCallback(
        (noteId: string, change: NoteEdit) => {
            if (!record) return;
            setSelectedNote(noteId);
            setAlignment({
                ...record,
                edits: new Map([...record.edits, [noteId, { ...record.edits.get(noteId), ...change }]]),
            });
        },
        [record, setAlignment],
    );

    /** Hand a divergence back to the transcriber: what was decided about it, and every note moved. */
    const reset = useCallback(
        (divergence: Divergence) => {
            if (!record) return;
            const kept = new Map(record.resolutions);
            kept.delete(divergence.id);
            const untouched = new Map(record.edits);
            for (const note of outcomes.get(divergence.id)?.notes ?? []) untouched.delete(note.id);
            setAlignment({ ...record, resolutions: kept, edits: untouched });
        },
        [record, outcomes, setAlignment],
    );

    /**
     * Move to the alteration before or after the one that is open, and bring it into view.
     *
     * In the order they stand on the page, which is the order they were played in. One whose
     * notes the engraving never draws — a repeat shown once, a note verovio placed nowhere — is
     * not on the page and so is not in the round.
     */
    const onPage = useCallback((): { id: string; element: Element }[] => {
        if (!root) return [];
        const seen = new Set<string>();
        const found: { id: string; element: Element }[] = [];
        // Not a note that has been bracketed: it is still in the layout, so it would answer the
        // query and then scroll nowhere and anchor the card to a point of no size
        for (const element of root.querySelectorAll('[data-divergence]:not([data-omitted])')) {
            const id = element.getAttribute('data-divergence');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            found.push({ id, element });
        }
        return found;
    }, [root]);

    const step = useCallback(
        (direction: -1 | 1) => {
            const all = onPage();
            if (all.length === 0) return;
            const at = all.findIndex((entry) => entry.id === selected);
            const next =
                all[at < 0 ? (direction > 0 ? 0 : all.length - 1) : (at + direction + all.length) % all.length];

            next.element.scrollIntoView({ block: 'center', inline: 'center' });
            setSelected(next.id);
            setSelectedNote(next.element.getAttribute('data-id') ?? undefined);
            setAnchor(next.element);
        },
        [onPage, selected],
    );

    /**
     * Open the card at the note it is about.
     *
     * Every alteration is somewhere in this score — a green note where one was added, a red one
     * where one was left out — so the click that asks about one is the click on it.
     */
    const onScoreClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const element = (event.target as Element).closest('[data-divergence]');
        const id = element?.getAttribute('data-divergence');

        // The card lets clicks through to the music beneath it, so a click on ordinary
        // notation is what closes it
        if (!id || !element) {
            setSelected(undefined);
            setSelectedNote(undefined);
            setAnchor(undefined);
            return;
        }
        setSelected(id);
        // A notehead carries the id of its note; a cross is no note of the score
        setSelectedNote(element.getAttribute('data-id') ?? undefined);
        setAnchor(element);
    }, []);

    const counts = useMemo(() => countsOf(divergences, outcomes), [divergences, outcomes]);
    const open = divergences.find((divergence) => divergence.id === selected);
    const busy = status !== undefined;

    const alignTooltip = !performance
        ? 'Open a MIDI recording of this score first'
        : busy
          ? 'The model is running'
          : `Put ${performance.name} note against note with this score, and write what was played differently into it`;

    const writeTooltip = !shown
        ? 'Nothing to write yet'
        : !unwritten
          ? 'The score already holds what is shown'
          : 'Write what is shown into the score, as readings beside the source';

    if (!mei) return null;

    return (
        <>
            <GlobalStyles styles={alignmentStyles(EXTRA_COLOUR, OMITTED_COLOUR)} />

            <DeskToolbar>
                <ToolGroup label="Performance">
                    <Box
                        component="select"
                        aria-label="Recording"
                        value={take ?? ''}
                        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                            setPicked(event.target.value);
                            setRun(undefined);
                        }}
                        sx={{ height: 30, borderRadius: 1, border: '1px solid #e5e7eb' }}
                    >
                        {takes.length === 0 && <option value="">No recording</option>}
                        {takes.map((entry) => (
                            <option key={entry} value={entry}>
                                {performances.find((p) => p.source === entry)?.name ?? entry}
                            </option>
                        ))}
                    </Box>
                    <ToolbarButton
                        label="Add recording"
                        tooltip="Open a MIDI performance of this score"
                        onClick={() => midiInput.current?.click()}
                    >
                        Add…
                    </ToolbarButton>
                    <ToolbarButton
                        label="Align"
                        tooltip={alignTooltip}
                        disabled={!performance || busy}
                        onClick={() => void align()}
                    >
                        {run || committed ? 'Align again' : 'Align'}
                    </ToolbarButton>
                </ToolGroup>

                <ToolGroup label="Played differently">
                    <Legend
                        entries={[
                            {
                                colour: EXTRA_COLOUR,
                                count: counts.added,
                                name: 'added',
                                meaning: 'Notes the performer played that the source does not write. They are written into the score.',
                            },
                            {
                                colour: OMITTED_COLOUR,
                                count: counts.omitted,
                                name: 'left out',
                                meaning: 'Notes the source writes that were not played. They are taken out of the performance reading.',
                            },
                            {
                                colour: REPLACED_COLOUR,
                                count: counts.changed,
                                name: 'changed',
                                meaning: 'Notes played at another pitch than written. The played pitch is written.',
                            },
                        ]}
                    />
                    <ToolbarButton
                        icon={<NavigateBefore fontSize="small" />}
                        label="Previous"
                        tooltip="Go to the one before"
                        disabled={counts.total === 0}
                        onClick={() => {
                            step(-1);
                        }}
                    />
                    <ToolbarButton
                        icon={<NavigateNext fontSize="small" />}
                        label="Next"
                        tooltip="Go to the next one"
                        disabled={counts.total === 0}
                        onClick={() => {
                            step(1);
                        }}
                    />
                </ToolGroup>

                <ToolGroup>
                    <ToolField
                        label="Decided by"
                        width={96}
                        value={resp}
                        onChange={(value) => {
                            if (record) setAlignment({ ...record, resp: value });
                        }}
                    />
                    <ToolbarButton
                        primary
                        label="Write into score"
                        tooltip={writeTooltip}
                        disabled={!unwritten || !shown || busy}
                        onClick={write}
                    >
                        Write into score
                    </ToolbarButton>
                </ToolGroup>

                <ToolGroup label="Zoom">
                    <Slider
                        aria-label="Zoom"
                        sx={{ width: '5rem', mx: 1 }}
                        min={4}
                        max={64}
                        step={2}
                        value={scale}
                        onChange={(_, value) => {
                            setScale(value as number);
                        }}
                    />
                </ToolGroup>
            </DeskToolbar>

            <Stack spacing={1} sx={{ p: 1 }}>
                {status && (
                    <Box sx={{ maxWidth: '32rem' }}>
                        <Typography variant="body2" color="text.secondary">
                            {status.text}
                        </Typography>
                        <Slider value={status.percent} max={100} disabled />
                    </Box>
                )}

                {error && (
                    <Alert
                        severity="error"
                        onClose={() => {
                            setError(undefined);
                        }}
                    >
                        {error}
                    </Alert>
                )}

                {mismatch && (
                    <Alert
                        severity="warning"
                        action={
                            <ToolbarButton
                                label="Align anyway"
                                tooltip="Align these two files even though they may not be the same music"
                                onClick={() => void align(true)}
                            >
                                Align anyway
                            </ToolbarButton>
                        }
                    >
                        {mismatch}
                    </Alert>
                )}

                {notices.map((notice) => (
                    <Alert
                        severity="warning"
                        key={notice}
                        onClose={() => {
                            setNotices((all) => all.filter((entry) => entry !== notice));
                        }}
                    >
                        {notice}
                    </Alert>
                ))}

                {failed && <Alert severity="error">{failed}</Alert>}

                {/* Only where there is a recording to hear. A transport over nothing is an
                    offer that cannot be taken. */}
                {(alignment?.spans.length ?? 0) > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                        <PlaybackBar playback={playback} />
                        {counts.total > 0 && (
                            <Typography variant="body2" color="text.secondary">
                                Click a coloured note to change how it is written.
                            </Typography>
                        )}
                    </Box>
                )}

                <Box
                    ref={setRoot}
                    onClick={onScoreClick}
                    sx={{
                        overflow: 'auto',
                        bgcolor: '#ffffff',
                        height: `calc(100vh - ${String(APP_BAR_HEIGHT)}px - 12rem)`,
                    }}
                >
                    {shown && (alignment?.spans.length ?? 0) > 0 ? (
                        <Score
                            className="alignment-score"
                            mei={shown}
                            options={options}
                            paint={paint}
                            extenders
                            extraNotes={marks.extraNotes}
                            omissions={marks.omissions}
                            style={{ width: 'max-content' }}
                        />
                    ) : (
                        /* What a new project opens on, and the only screen in the editor a reader
                           reaches before there is anything to look at. It says the next thing to
                           do rather than leaving the page blank. */
                        <Stack spacing={1} sx={{ p: 4, maxWidth: '34rem' }}>
                            <Typography variant="h6">Nothing aligned yet</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Add a recording and press Align. What was played differently is
                                written into the score: added notes green, left out red, changed
                                violet.
                            </Typography>
                        </Stack>
                    )}
                </Box>
            </Stack>

            {/* Reached through `midiInput`, and it resets its own value on change — so the same
                file can be chosen again after being refused. */}
            <input
                ref={midiInput}
                type="file"
                accept=".mid,.midi"
                style={{ display: 'none' }}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) openPerformance(file);
                    event.target.value = '';
                }}
            />

            <AlterationEditor
                divergence={open}
                outcome={selected ? outcomes.get(selected) : undefined}
                anchor={anchor}
                mei={shown}
                paint={paintBar}
                noteId={selectedNote}
                changed={
                    selected !== undefined &&
                    (resolutions.has(selected) ||
                        (outcomes.get(selected)?.notes ?? []).some((note) => edits.has(note.id)))
                }
                onChoose={choose}
                onEdit={edit}
                onReset={reset}
                onClose={() => {
                    setSelected(undefined);
                    setSelectedNote(undefined);
                    setAnchor(undefined);
                }}
            />
        </>
    );
};
