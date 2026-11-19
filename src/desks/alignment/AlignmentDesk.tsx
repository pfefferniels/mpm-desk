import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, GlobalStyles, Popper, Slider, Stack, Tooltip, Typography } from '@mui/material';
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
    type SignKind,
} from '../../alignment/transcription';
import { ornamentSignsOf } from '../../mei/ornamentSigns';
import { parseRecordings } from '../../mei/parseRecordings';
import type { PlayablePedal } from '../../performance/buildMidiFile';
import { asSpans } from '../../performance/midiSpans';
import { heldTiesOf, type ScoreNote } from '../../score/scoreNotes';
import { Score } from '../../verovio/Score';
import { DEFAULT_PERFORMANCE_SCALE, performedOptions, unitsPerSecond } from '../../verovio/toolkit';
import { EXTRA_COLOUR } from '../../verovio/extraNotes';
import { OMITTED_COLOUR } from '../../verovio/omissionMarks';
import { useScoreDocument } from '../../hooks/ScoreDocument';
import { usePerformances, type Performance } from '../../hooks/Performances';
import { useWorkDocument } from '../../hooks/WorkDocument';
import type { WorkAlignment } from '../../model/workReducer';
import { APP_BAR_HEIGHT } from '../../components/toolbar/EditorAppBar';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton, ToolbarToggle } from '../../components/toolbar/ToolbarButton';
import { AlterationEditor } from './AlterationEditor';
import { anchorsOf, certaintyOf, paintCertainty } from './certainty';
import { Legend } from './Legend';
import { RollPreview } from './RollPreview';
import { excerptOf, type RollKind } from './rollExcerpt';
import { PlaybackBar } from './PlaybackBar';
import { REPLACED_COLOUR, alignmentStyles, paintAlignment, paintingOf } from './paintAlignment';
import { marksOf } from './marks';
import { readScore, runAlignment, type AlignmentRun, type Status } from './runAlignment';
import { useRecordingPlayback } from './useRecordingPlayback';
import { momentOf } from './momentOf';
import { sameDocument } from '../../mei/sameDocument';

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

/**
 * The coloured note a click fell on, where it did not fall on the note's ink.
 *
 * A half note's head is a ring, and a click in the middle of it lands on the staff behind it.
 * So this asks the boxes and not the paths: the note whose head the point is in, give or take
 * what a hand misses by.
 */
const markedAt = (root: Element, x: number, y: number, which = '[data-divergence]'): Element | null => {
    const REACH = 3;
    for (const element of root.querySelectorAll(which)) {
        const box = element.querySelector('.notehead')?.getBoundingClientRect();
        // Nothing drawn, or nothing laid out: no box to be in
        if (!box || box.width === 0 || box.height === 0) continue;
        if (x >= box.left - REACH && x <= box.right + REACH && y >= box.top - REACH && y <= box.bottom + REACH) {
            return element;
        }
    }
    return null;
};

/** What a pointer resting on the page can ask about: a note, or a played note with none. */
const HOVERABLE = 'g.note[data-id], .performanceExtraNote[data-perf-id]';

/** How much of the recording is sounded around an alteration when the reader asks to hear it. */
const HEAR_BEFORE_MS = 1500;
const HEAR_AFTER_MS = 2500;

/** How long after the reader's last change the page is written into the document. */
const AUTOSAVE_MS = 600;

/**
 * The size the score opens at, as verovio's `scale`: a percentage of the engraving's own size.
 *
 * Under the 70 the other score views use. Those show a few bars at a time; this one is read
 * across a whole performance for the handful of notes that are coloured, and at 70 two systems
 * filled the window. Not far under: at 40 the notes were too small to be read without leaning in.
 */
const DEFAULT_ZOOM = 55;

/** Room left between the end of a system and whatever stands to its right, in pixels. */
const RIGHT_MARGIN = 24;

/**
 * How much of the score's width the list of aspects stands in front of.
 *
 * The list floats over the desk's top right corner. A system drawn the full width of the window
 * would run under it, so the music stops short of it; with the list folded away there is
 * next to nothing to stop short of, and the music takes the width back.
 */
const coveredOf = (root: Element): number => {
    const card = document.querySelector('[data-aspect-select]');
    if (!card) return 0;
    const over = root.getBoundingClientRect().right - card.getBoundingClientRect().left;
    return Math.max(0, Math.ceil(over));
};

/**
 * What a system needs before its music, in pixels at a given zoom: the page's margin, the clef
 * and the key. Measured on the engraving. A first system with a time signature and a label
 * needs more, which is found out when it has been engraved (see `paintScore`).
 */
const besideTheMusic = (zoom: number) => 8 + 3.2 * zoom;

/**
 * How many seconds of the recording one system holds, so that it is as wide as the window.
 *
 * The performed layout breaks its systems by time, at a length it is told. Told the same length
 * at every zoom, a small score would fill half the window's width and a large one would run off
 * it; so the length follows the width there is and the zoom the score is drawn at.
 */
const secondsAcross = (width: number, zoom: number, stretch: number): number =>
    Math.min(
        120,
        Math.max(SHORTEST_SYSTEM, Math.floor((width - besideTheMusic(zoom)) / pixelsPerSecond(zoom, stretch))),
    );

/** How wide a second of the recording is drawn at a zoom and a width, in pixels. */
const pixelsPerSecond = (zoom: number, stretch: number): number =>
    (unitsPerSecond({ performanceScale: DEFAULT_PERFORMANCE_SCALE * stretch }) * zoom) / 1000;

/**
 * How much wider than the default a second of the recording is drawn.
 *
 * The zoom makes the notes and the seconds larger together, so it cannot make room: a passage
 * of eight notes a second is as crowded at any zoom. This is the other dial, the seconds alone.
 */
const DEFAULT_STRETCH = 1;

/** No system is asked to hold less than this many seconds, however narrow the window. */
const SHORTEST_SYSTEM = 4;

/** How many notes were added, left out and changed, which is what the legend counts. */
const countsOf = (divergences: readonly Divergence[], outcomes: ReadonlyMap<string, Outcome>) => {
    const counts = { added: 0, omitted: 0, changed: 0, total: 0 };
    for (const divergence of divergences) {
        const outcome = outcomes.get(divergence.id);
        if (!outcome) continue;
        counts.total++;
        if (divergence.kind === 'added' && outcome.written === 'variant') counts.changed++;
        else if (divergence.kind === 'added') counts.added += outcome.noteIds.length;
        else if (divergence.kind === 'missing' && outcome.written === 'omitted') {
            counts.omitted += divergence.scoreIds.length;
        } else if (divergence.kind === 'replaced' && outcome.written === 'variant') counts.changed++;
    }
    return counts;
};


export const AlignmentDesk = () => {
    const { mei, setMei } = useScoreDocument();
    const { performances, openPerformance } = usePerformances();
    const { alignments, setAlignment, metadata } = useWorkDocument();
    const midiInput = useRef<HTMLInputElement>(null);

    /** The take under review. The first there is, until somebody picks another. */
    const [picked, setPicked] = useState<string>();
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [stretch, setStretch] = useState(DEFAULT_STRETCH);
    /**
     * How the page is laid out: as the score is written, or along the recording.
     *
     * Written, by default. The bars keep the widths and the lines the breaks the notation gives
     * them, so the page reads as a score; what was played that the score does not write is drawn
     * among the notes it was played between. Along the recording, every note stands where it
     * was struck, which says when, at the price of a page that is crowded wherever the playing
     * is fast.
     */
    const [layout, setLayout] = useState<'notated' | 'performed'>('notated');
    /** Whether pointing at a note shows its bar as it was played. */
    const [rollOnHover, setRollOnHover] = useState(true);
    /** The note the pointer rests on, and the bar it is in. */
    const [hovered, setHovered] = useState<{
        element: Element;
        noteId?: string;
        perfId?: string;
        bar: string[];
        measure?: string;
    }>();

    /** This session's run, until it is written. Absent means: show what the document holds. */
    const [run, setRun] = useState<AlignmentRun>();
    /** Whether the reader has done anything here yet: aligned, or changed how something is written. */
    const [touched, setTouched] = useState(false);
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
    // Who answers for the readings: the editor of the reconstruction. Asked once, where the
    // work is named, and not again on every desk that writes something
    const resp = metadata.author.trim();

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
        return { ...run.result, spans: run.spans, confidenceKnown: true };
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
     * `written` is the document: what goes into the score. `shown` is the same with the
     * notes the performer left out still standing, in red, because a note that has been taken
     * out cannot be seen to have been taken out. The page shows more than the document holds,
     * and what it shows beyond it is exactly the red.
     */
    const transcription = useMemo(() => {
        if (!aligned?.mei || !take || !alignment || divergences.length === 0) return undefined;

        const choices = new Map<string, Notation>();
        const signs = new Map<string, SignKind>();
        for (const divergence of divergences) {
            const resolution = resolutions.get(divergence.id);
            if (resolution?.action) choices.set(divergence.id, notationOf(resolution.action));
            if (resolution?.sign) signs.set(divergence.id, resolution.sign);
        }
        try {
            const input = {
                mei: aligned.mei,
                source: take,
                divergences,
                spans: alignment.spans,
                edits,
                signs,
                resp: resp || undefined,
            };
            const written = transcribe({ ...input, choices });
            const shown = transcribe({ ...input, choices, omissionsStand: true });
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

    /**
     * When the written notes the model was sure of were struck: on the notated page, the notes a
     * played note with no written one is drawn between. See `./certainty`.
     */
    const moments = useMemo(
        () => (alignment ? anchorsOf(alignment.matches, alignment.spans, run?.hidden) : undefined),
        [alignment, run],
    );

    const marks = useMemo(
        () => marksOf(divergences, alignment?.spans ?? [], outcomes),
        [divergences, alignment, outcomes],
    );

    // The ties of what is on the page: one the performer did not hold is no longer among them
    const ties = useMemo(() => (shown ? heldTiesOf(shown) : undefined), [shown]);

    const painting = useMemo(
        () =>
            paintingOf({
                matches: alignment?.matches ?? [],
                deletions: alignment?.deletions ?? [],
                divergences,
                minConfidence: 0,
                hidden: run?.hidden ?? new Set(),
                outcomes,
                ties,
            }),
        [alignment, divergences, run, outcomes, ties],
    );

    /**
     * How sure the model was of each note, which the notated page draws as how faint it is.
     * Nothing, where the document does not say: a note nothing is known of is drawn in full.
     */
    const certainty = useMemo(
        () =>
            alignment?.confidenceKnown
                ? certaintyOf({ ...alignment, divergences, outcomes, ties })
                : undefined,
        [alignment, divergences, outcomes, ties],
    );

    /**
     * What the roll of a bar needs to know: which key each note of the page was played as, what
     * each key was, and which written notes nothing was played for.
     */
    const roll = useMemo(() => {
        const spans = alignment?.spans ?? [];
        const playedOf = new Map((alignment?.matches ?? []).map((match) => [match.scoreId, match.performanceId]));
        const kindOf = new Map<string, Exclude<RollKind, 'unplayed'>>();
        for (const insertion of alignment?.insertions ?? []) kindOf.set(insertion.performanceId, 'added');
        const byWritten = new Map(spans.map((span) => [writtenIdOf(span), span.id]));
        for (const divergence of divergences) {
            const outcome = outcomes.get(divergence.id);
            if (divergence.kind === 'replaced') {
                kindOf.set(divergence.perfId, 'replaced');
                for (const id of outcome?.noteIds ?? []) playedOf.set(id, divergence.perfId);
                continue;
            }
            for (const note of outcome?.notes ?? []) {
                const span = byWritten.get(note.played);
                if (!span) continue;
                playedOf.set(note.id, span);
                if (divergence.kind === 'added' && outcome?.written === 'variant') kindOf.set(span, 'replaced');
            }
        }
        // A unison's twin and a note beyond the recording were not left out by anyone
        const unplayed = new Set(
            [...painting.unplayed].filter((id) => !painting.kept.has(id) && !painting.outside.has(id)),
        );
        const writtenOf = new Map(scoreNotes.map((note) => [note.note, note]));
        return { spans, playedOf, kindOf, unplayed, writtenOf };
    }, [alignment, divergences, outcomes, painting, scoreNotes]);

    const excerpt = useMemo(
        () => (hovered ? excerptOf({ ...roll, bar: hovered.bar, hovered }) : undefined),
        [hovered, roll],
    );

    const paint = useCallback(
        (element: HTMLElement) => {
            paintAlignment(element, painting, selected);
            paintCertainty(element, layout === 'notated' ? certainty : undefined);

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
        [painting, selected, selectedNote, layout, certainty],
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

    // The width the score has to be drawn into. Followed with a delay: engraving a whole
    // performance takes a moment, and a window being dragged wider asks for it sixty times
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!root || typeof ResizeObserver === 'undefined') return;
        let pending: ReturnType<typeof setTimeout> | undefined;
        let known = false;
        const observer = new ResizeObserver(() => {
            clearTimeout(pending);
            // The first answer at once, so that the score is engraved once and at the right
            // length; the ones after it when the window has come to rest
            pending = setTimeout(
                () => {
                    setWidth(root.clientWidth - coveredOf(root) - RIGHT_MARGIN);
                },
                known ? 200 : 0,
            );
            known = true;
        });
        observer.observe(root);
        // The list of aspects too: folded away or opened, it changes the room there is
        const card = document.querySelector('[data-aspect-select]');
        if (card) observer.observe(card);
        return () => {
            clearTimeout(pending);
            observer.disconnect();
        };
    }, [root]);

    // Where the desk begins under the bar, measured: the bar is as tall as its rows and its
    // rule, and wraps to more rows in a narrow window, so a constant is right only sometimes,
    // and wrong by a pixel is a scrollbar down the whole page
    const frame = useRef<HTMLDivElement>(null);
    const [top, setTop] = useState(APP_BAR_HEIGHT);
    useLayoutEffect(() => {
        const measure = () => {
            const element = frame.current;
            if (element) setTop(Math.ceil(element.getBoundingClientRect().top + window.scrollY));
        };
        measure();
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('resize', measure);
        };
    }, []);

    /**
     * Seconds taken off every system, because the engraving came out wider than it was asked to.
     *
     * A system is broken at a note, not at a moment: asked for twelve seconds, it runs on to the
     * next thing struck, and in slow music that is a second or two further on. How far cannot
     * be known before the score is engraved, so it is looked at afterwards and, where a system
     * has run over, engraved once more a little shorter. Kept with the width and zoom it was
     * found for, so that another window starts from what it asks for.
     */
    const [trimmed, setTrimmed] = useState({ fit: '', seconds: 0 });
    const fit = `${String(width)}:${String(zoom)}:${String(stretch)}:${take ?? ''}`;
    const trim = trimmed.fit === fit ? trimmed.seconds : 0;
    const seconds = width > 0 ? Math.max(SHORTEST_SYSTEM, secondsAcross(width, zoom, stretch) - trim) : undefined;

    // The engraving last looked at, by its first system. The page is painted again whenever a
    // note is selected or this very answer changes, and the score on it is then still the one
    // already judged: judged twice, it would be found too wide twice and shortened twice.
    const judged = useRef<Element | null>(null);

    const paintScore = useCallback(
        (element: HTMLElement) => {
            paint(element);
            // The notated page breaks its own lines, at the width it was given
            if (layout !== 'performed') return;
            if (!root || seconds === undefined || seconds <= SHORTEST_SYSTEM) return;

            const first = element.querySelector('g.system');
            if (!first || first === judged.current) return;
            judged.current = first;

            // Where each system ends, from the left edge of the score
            const origin = root.getBoundingClientRect().left - root.scrollLeft;
            const ends = [...element.querySelectorAll('g.system')].map(
                (system) => system.getBoundingClientRect().right - origin,
            );
            if (ends.length === 0) return;
            const byLength = [...ends].sort((a, b) => a - b);

            // The first system is to end where it was asked to, being the one the list of
            // aspects stands beside, and so are four in five of all of them. Not every one: a
            // chord held for eight seconds makes its system eight seconds longer whatever is
            // asked, and shortening all the others for its sake would leave a page of
            // fragments. That one only has to stay inside the window, so that the page does
            // not scroll sideways.
            const most = byLength[Math.max(0, Math.ceil(byLength.length * 0.8) - 1)];
            const widest = byLength[byLength.length - 1];
            const over = Math.max(0, ends[0] - width, most - width, widest - root.clientWidth);
            if (over > 1) {
                setTrimmed({ fit, seconds: trim + Math.ceil(over / pixelsPerSecond(zoom, stretch)) });
            }
        },
        [paint, layout, root, seconds, width, zoom, stretch, fit, trim],
    );
    const options = useMemo(
        () =>
            layout === 'performed'
                ? {
                      ...performedOptions,
                      scale: zoom,
                      performanceScale: DEFAULT_PERFORMANCE_SCALE * stretch,
                      ...(seconds !== undefined && { performanceSystemDuration: seconds }),
                      performanceRecording: take ?? '',
                  }
                : {
                      scale: zoom,
                      // As wide as the window, which is what the lines are broken at. The page
                      // is drawn at `scale` percent of its own width, so the width it is given
                      // is the window's taken back by as much
                      ...(width > 0 && { pageWidth: Math.round((width * 100) / zoom) }),
                      // One page however long the piece: the window scrolls, and a page break
                      // would be a gap in the music
                      pageHeight: 60000,
                  },
        [layout, zoom, stretch, seconds, take, width],
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
     *
     * A note that also stands in the bar of an open alteration lights there as well: that bar
     * is what the reader is looking at while the place is heard, and it lies over the page.
     */
    const elementsFor = useCallback(
        (performanceId: string) => {
            if (!root) return [];
            const escaped = (id: string) =>
                typeof CSS?.escape === 'function' ? CSS.escape(id) : id;
            const noteId = pageNoteOf.get(performanceId);
            if (!noteId) {
                const cross = root.querySelector(`[data-perf-id="${escaped(performanceId)}"]`);
                return cross ? [cross] : [];
            }
            const drawn = `[data-id="${escaped(noteId)}"]`;
            const onPage = root.querySelector(drawn);
            return [
                ...(onPage ? [onPage] : []),
                ...document.querySelectorAll(`.alignment-bar ${drawn}`),
            ];
        },
        [root, pageNoteOf],
    );

    const playback = useRecordingPlayback({
        notes: alignment?.spans ?? [],
        pedals,
        elementsFor,
    });

    const align = useCallback(
        async (allowMismatch = false, of?: Performance) => {
            // The take on the desk, or one just opened that the desk has not turned to yet
            const target = of ?? performance;
            const name = of?.source ?? take;
            if (!source || !target || !name) return;

            setError(undefined);
            setMismatch(undefined);
            setSelected(undefined);
            setAnchor(undefined);

            try {
                const fresh = await runAlignment({
                    mei: source,
                    midi: target.midi,
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
                const before = alignments.find((entry) => entry.source === name);
                setAlignment({
                    source: name,
                    midi: target.name,
                    model: DEFAULT_MODEL,
                    minConfidence: 0,
                    resolutions: before?.resolutions ?? EMPTY_RESOLUTIONS,
                    edits: before?.edits ?? EMPTY_EDITS,
                    resp,
                    certainty: before?.certainty ?? 'medium',
                });
                setTouched(true);
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
        [source, performance, take, alignments, setAlignment, resp],
    );

    /**
     * Whether the page shows something the document does not hold yet.
     *
     * Asked of what the two say rather than of their text: the same transcription serialises
     * with its attributes in another order after a round trip, and writing for that would be
     * writing nothing, at the price of a fit. But asked of everything they say. A note put on
     * the other staff, or moved along its bar, is the same notes in another place, and a
     * question that only counts the notes would leave it on the page and out of the document.
     */
    const unwritten = useMemo(() => {
        if (run) return true;
        if (!mei || !transcription?.written) return false;
        return !sameDocument(transcription.written, mei);
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
            resp,
            certainty: 'medium',
        };
    }, [recorded, take, performance, resp]);

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
        if (record) setAlignment({ ...record, resp }, transcription?.readings ?? []);
        setRun(undefined);
    }, [transcription, aligned, setMei, record, setAlignment, resp]);

    /**
     * The document follows the page, a moment after the reader has done something.
     *
     * There is no button for it. A page that shows what the document does not hold is a state
     * with one use, forgetting to leave it, and what is on the page is always the whole of
     * what the reader meant.
     *
     * A moment after, because a new score is a new fit: a note moved four places in a second
     * is written once, where it came to rest. And only once the reader has done something. A
     * document made by an earlier build, or by other hands, may hold readings this
     * transcriber would write differently; opening it to look must not rewrite it.
     *
     * One change is written once. What the reader did is spent by the writing of it, so a
     * document that comes back saying something else - undone, or changed on another desk -
     * is not written over again by a change made before that.
     */
    const busy = status !== undefined;
    useEffect(() => {
        if (!touched || busy) return;
        const timer = setTimeout(() => {
            if (unwritten) write();
            setTouched(false);
        }, AUTOSAVE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [touched, unwritten, busy, write]);

    const choose = useCallback(
        (divergence: Divergence, notation: Notation, sign?: SignKind) => {
            if (!record) return;
            setTouched(true);
            setAlignment({
                ...record,
                resolutions: new Map([
                    ...record.resolutions,
                    [
                        divergence.id,
                        {
                            reading: divergence.reading,
                            action: actionFor(divergence, notation),
                            // Which sign, where the reader said which: without it the
                            // transcriber reads the sign off the figure
                            ...(notation === 'sign' && sign && { sign }),
                        },
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
            setTouched(true);
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
            setTouched(true);
            const kept = new Map(record.resolutions);
            kept.delete(divergence.id);
            const untouched = new Map(record.edits);
            // By the note written and by the key played: a played note matched to a written
            // one is kept under the key, and written under the note it stands for
            for (const note of outcomes.get(divergence.id)?.notes ?? []) {
                untouched.delete(note.id);
                untouched.delete(note.played);
            }
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
        const element =
            (event.target as Element).closest('[data-divergence]') ??
            markedAt(event.currentTarget, event.clientX, event.clientY);
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

    /**
     * The note the pointer rests on, asked once it has come to rest: a pointer crossing the page
     * on its way somewhere else is not asking about every note it passes. Asked of the ink first
     * and then of the boxes, because the middle of a whole note's head is a hole.
     */
    const resting = useRef<{ element: Element | null; timer?: ReturnType<typeof setTimeout> }>({ element: null });
    const onScoreHover = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            clearTimeout(resting.current.timer);
            const leaving = event.type === 'mouseleave' || !rollOnHover;
            const host = event.currentTarget;
            const direct = (event.target as Element).closest(HOVERABLE);
            const { clientX, clientY } = event;
            resting.current.timer = setTimeout(
                () => {
                    const target = leaving ? null : (direct ?? markedAt(host, clientX, clientY, 'g.note[data-id]'));
                    if (target === resting.current.element) return;
                    resting.current.element = target;
                    if (!target) {
                        setHovered(undefined);
                        return;
                    }
                    const measure = target.closest('.measure');
                    setHovered({
                        element: target,
                        noteId: target.getAttribute('data-id') ?? undefined,
                        perfId: target.getAttribute('data-perf-id') ?? undefined,
                        bar: [...(measure?.querySelectorAll('g.note[data-id]') ?? [])].map(
                            (note) => note.getAttribute('data-id') ?? '',
                        ),
                        measure: measure?.getAttribute('data-n') ?? undefined,
                    });
                },
                leaving ? 150 : 250,
            );
        },
        [rollOnHover],
    );
    useEffect(() => () => clearTimeout(resting.current.timer), []);

    const counts = useMemo(() => countsOf(divergences, outcomes), [divergences, outcomes]);
    const open = divergences.find((divergence) => divergence.id === selected);

    /**
     * Hear the place the open alteration is at: a second and a half before it, and long
     * enough after for what follows to answer. Pressed while it sounds, it stops.
     */
    const hear = useCallback(() => {
        if (playback.playing || playback.pending) {
            playback.stop();
            return;
        }
        if (!open || !alignment) return;

        const at = momentOf(open, alignment.matches, alignment.spans, scoreNotes);
        if (at === undefined) return;
        playback.playStretch(Math.max(0, at - HEAR_BEFORE_MS), at + HEAR_AFTER_MS);
    }, [open, alignment, scoreNotes, playback]);

    /**
     * The notes in the open alteration's bar that it could be the same note as.
     *
     * A played note with nothing written for it and a written note nothing played, in one bar,
     * may be one note the aligner did not pair: struck late, or at another pitch. Which, only
     * a reader can say, and these are what they can say it of.
     */
    const counterparts = useMemo(() => {
        const bar = open ? outcomes.get(open.id)?.measure : undefined;
        if (!open || bar === undefined) return [];
        return divergences.flatMap((other) => {
            const outcome = outcomes.get(other.id);
            if (outcome?.measure !== bar) return [];
            if (open.kind === 'added' && other.kind === 'missing' && outcome.written === 'omitted') {
                return other.scoreIds;
            }
            if (open.kind === 'missing' && other.kind === 'added') {
                // Notes written for a key, not written notes a key turned out to be
                return outcome.notes.filter((note) => note.id === note.played).map((note) => note.id);
            }
            return [];
        });
    }, [open, divergences, outcomes]);
    const alignTooltip = !performance
        ? 'Open a MIDI recording of this score first'
        : busy
          ? 'The model is running'
          : `Put ${performance.name} note against note with this score, and write what was played differently into it`;

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

                <ToolGroup label="Layout">
                    <ToolbarToggle
                        label="Performed"
                        tooltip={
                            layout === 'performed'
                                ? 'Every note stands where it was struck. Press again for the score as it is written, with what was played that it does not write drawn among the notes it was played between'
                                : 'Lay the score out along the recording, every note where it was struck, rather than as it is written'
                        }
                        selected={layout === 'performed'}
                        onChange={(performed) => {
                            setLayout(performed ? 'performed' : 'notated');
                        }}
                    >
                        Performed
                    </ToolbarToggle>
                    <ToolbarToggle
                        label="Roll on hover"
                        tooltip={
                            rollOnHover
                                ? 'Pointing at a note shows its bar as it was played. Press to stop'
                                : 'Show the bar a note is in as it was played, as a piano roll, when the pointer rests on it'
                        }
                        selected={rollOnHover}
                        onChange={(on) => {
                            setRollOnHover(on);
                            if (!on) setHovered(undefined);
                        }}
                    >
                        Roll on hover
                    </ToolbarToggle>
                </ToolGroup>

                <ToolGroup label="Zoom">
                    <Slider
                        aria-label="Zoom"
                        sx={{ width: '5rem', mx: 1 }}
                        min={20}
                        max={100}
                        step={5}
                        value={zoom}
                        onChange={(_, value) => {
                            setZoom(value as number);
                        }}
                    />
                </ToolGroup>

                <ToolGroup label="Width">
                    <Tooltip
                        describeChild
                        title={
                            layout === 'performed'
                                ? 'How wide a second of the recording is drawn'
                                : 'Only the performed layout has seconds to widen: the written one spaces its bars itself'
                        }
                    >
                        <span style={{ display: 'inline-flex' }}>
                            <Slider
                                aria-label="Width"
                                disabled={layout !== 'performed'}
                                getAriaValueText={(value) => `${String(value)} times as wide`}
                                sx={{ width: '5rem', mx: 1 }}
                                min={1}
                                max={4}
                                step={0.5}
                                value={stretch}
                                onChange={(_, value) => {
                                    setStretch(value as number);
                                }}
                            />
                        </span>
                    </Tooltip>
                </ToolGroup>
            </DeskToolbar>

            {/* As tall as the window under the bar, and the score takes what the notices above
                it leave: the music runs to the bottom edge however much is said over it. */}
            <Stack
                ref={frame}
                spacing={1}
                sx={{
                    p: 1,
                    pb: 0,
                    boxSizing: 'border-box',
                    height: `calc(100dvh - ${String(top)}px)`,
                }}
            >
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
                    onMouseMove={onScoreHover}
                    onMouseLeave={onScoreHover}
                    sx={{
                        overflow: 'auto',
                        bgcolor: '#ffffff',
                        flex: '1 1 0',
                        minHeight: 0,
                    }}
                >
                    {shown && (alignment?.spans.length ?? 0) > 0 ? (
                        <Score
                            className="alignment-score"
                            mei={shown}
                            options={options}
                            paint={paintScore}
                            extenders={layout === 'performed'}
                            anchors={layout === 'notated' ? moments : undefined}
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
                                Add a recording. It is aligned with the score at once, and
                                what was played differently is written into it: added notes
                                green, left out red, changed violet.
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
                    event.target.value = '';
                    if (!file) return;
                    // A recording is added to this desk to be aligned, and so it is, at once:
                    // there is nothing else to do with it here, and a button to press first
                    // would only be a thing to find
                    void Promise.resolve(openPerformance(file)).then((opened) => {
                        if (!opened) return;
                        setPicked(opened.source);
                        return align(false, opened);
                    });
                }}
            />

            {/* Not while a card is open: the card is about the same bar, and two things floating
                over one note is one too many */}
            <Popper
                open={Boolean(hovered?.element.isConnected && excerpt && !selected)}
                anchorEl={hovered?.element}
                placement="top"
                modifiers={[{ name: 'offset', options: { offset: [0, 12] } }]}
                sx={{ zIndex: (theme) => theme.zIndex.tooltip, pointerEvents: 'none' }}
            >
                {excerpt && <RollPreview excerpt={excerpt} bar={hovered?.measure} />}
            </Popper>

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
                        (outcomes.get(selected)?.notes ?? []).some(
                            (note) => edits.has(note.id) || edits.has(note.played),
                        ))
                }
                counterparts={counterparts}
                hearing={playback.playing || playback.pending}
                onHear={hear}
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
