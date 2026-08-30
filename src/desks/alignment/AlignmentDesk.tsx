import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, GlobalStyles, Slider, Stack, Typography } from '@mui/material';
import { applyAlignment } from '../../alignment/applyAlignment';
import { divergencesOf, type Divergence } from '../../alignment/divergences';
import { MismatchedPairError, hasRepeatSigns, toMatches } from '../../alignment/mlign';
import { MLIGN_MODELS, type MlignModelId } from '../../alignment/mlign/models';
import { recordedAlignment, type RecordedAlignment } from '../../alignment/recorded';
import { CERTAINTIES, changesNotation, type Attribution, type Resolution } from '../../alignment/readings';
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
import { APP_BAR_HEIGHT } from '../../components/toolbar/EditorAppBar';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { ToolField } from '../../components/toolbar/ToolField';
import { ToolStatus } from '../../components/toolbar/ToolStatus';
import { DivergencePopover } from './DivergencePopover';
import { PlaybackBar } from './PlaybackBar';
import { alignmentStyles, paintAlignment, paintingOf } from './paintAlignment';
import { marksOf } from './marks';
import { applyToScore } from './applyToScore';
import { readScore, runAlignment, type AlignmentRun, type Status } from './runAlignment';
import { useRecordingPlayback } from './useRecordingPlayback';

/**
 * Which sounding event realises which written note.
 *
 * The desk that comes before every other one. Nothing else here can say anything until this has:
 * the chain fits a performance to a recording, and until the score and the recording have been put
 * note against note there is no recording to fit to — only an engraving and a MIDI file that
 * nothing relates.
 *
 * ## What it writes, and where
 *
 * The matching itself goes into the MEI, as the `<performance>` of the As Played By customization:
 * a `<recording>` per take, full of `<when>` elements saying which note sounded when, how loudly
 * and for how long. That is the interchange format, it is what verovio lays the performed score
 * out from, and it is what `asMSM` reads to build the alignment the chain folds over. So the desk
 * rewrites the MEI — the one desk that does, and `ScoreDocument` says why.
 *
 * What the *reader* decides goes into the work file, on an `Align` call per take. One thing about
 * a decision does not survive the MEI: an action. A `<when>` carries the reading, the
 * responsibility and the certainty, and nothing in it says whether the played notes were to be
 * written into the score or the unplayed ones marked as a simplification.
 *
 * ## Align, then Apply
 *
 * Align runs the model and leaves the result standing as a draft. Nothing reaches either document
 * until Apply, and that is what makes the confidence floor usable: moving it re-derives the score
 * from a run already in hand rather than running the model again, which is a minute of work to
 * answer a question about a slider.
 */

const EMPTY_RESOLUTIONS: ReadonlyMap<string, Resolution> = new Map();

export const AlignmentDesk = () => {
    const { mei, setMei } = useScoreDocument();
    const { performances, openPerformance } = usePerformances();
    const { alignments, setAlignment } = useWorkDocument();
    const midiInput = useRef<HTMLInputElement>(null);

    /** The take under review. The first there is, until somebody picks another. */
    const [picked, setPicked] = useState<string>();
    const [model, setModel] = useState<MlignModelId>('v3');
    const [minConfidence, setMinConfidence] = useState(0);
    const [sliderValue, setSliderValue] = useState(0);
    const [scale, setScale] = useState(DEFAULT_PERFORMANCE_SCALE);
    const [performed, setPerformed] = useState(true);

    /** This session's run, until it is applied. Absent means: show what the document holds. */
    const [run, setRun] = useState<AlignmentRun>();
    const [status, setStatus] = useState<Status>();
    const [error, setError] = useState<string>();
    /** The two files do not look like the same music; the reader may insist. */
    const [mismatch, setMismatch] = useState<string>();
    const [notices, setNotices] = useState<string[]>([]);

    /** The notes of the score, which both a fresh run and a re-read alignment are grouped over. */
    const [scoreNotes, setScoreNotes] = useState<ScoreNote[]>([]);

    /** The disagreement the reader has opened, and the mark they opened it on. */
    const [selected, setSelected] = useState<string>();
    const [anchor, setAnchor] = useState<Element>();
    const [root, setRoot] = useState<HTMLDivElement | null>(null);

    /**
     * Every take there is to review.
     *
     * Three sources of one answer, and the third is the one that must not be left out: the MEI is
     * where an alignment *lives*, so a score that arrives already aligned — by an earlier session,
     * by another tool, by the file somebody was sent — holds takes that no `Align` call and no
     * open MIDI file mentions. Reading only the other two showed such a document as having nothing
     * to look at.
     */
    const sources = useMemo(() => {
        const inScore = mei
            ? parseRecordings(mei).recordings.map((entry) => entry.source)
            : [];
        return [
            ...new Set([
                ...inScore,
                ...performances.map((performance) => performance.source),
                ...alignments.map((alignment) => alignment.source),
            ]),
        ];
    }, [mei, performances, alignments]);

    const source = picked && sources.includes(picked) ? picked : sources[0];
    const performance = performances.find((entry) => entry.source === source);
    const recorded = alignments.find((entry) => entry.source === source);

    const resolutions = recorded?.resolutions ?? EMPTY_RESOLUTIONS;
    /** Memoised, because it is a dependency of `apply` and of `align` and is read off the call. */
    const attribution = useMemo<Attribution>(
        () => ({ resp: recorded?.resp ?? '', certainty: recorded?.certainty ?? 'medium' }),
        [recorded?.resp, recorded?.certainty],
    );

    // ── what is on screen ─────────────────────────────────────────

    useEffect(() => {
        if (!mei) return;
        let live = true;
        readScore(mei)
            .then((notes) => {
                if (live) setScoreNotes(notes);
            })
            .catch((reason: unknown) => {
                if (live) setError(reason instanceof Error ? reason.message : String(reason));
            });
        return () => {
            live = false;
        };
    }, [mei]);

    /** The alignment the document holds for this take, where it holds one. */
    const committed = useMemo((): RecordedAlignment | undefined => {
        if (!mei || !source) return undefined;
        const info = parseRecordings(mei).recordings.find((entry) => entry.source === source);
        return info ? recordedAlignment(info) : undefined;
    }, [mei, source]);

    /** A fresh run stands in front of what the document holds, until it is applied. */
    const alignment: RecordedAlignment | undefined = useMemo(() => {
        if (!run) return committed;
        return { ...run.result, spans: run.spans };
    }, [run, committed]);

    const signs = useMemo(() => (mei ? ornamentSignsOf(mei) : new Map()), [mei]);
    const hasRepeats = useMemo(() => (mei ? hasRepeatSigns(mei) : false), [mei]);

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
     * The score as it would be written: the matching, the disagreements, and what the reader has
     * settled about them.
     *
     * Derived rather than committed, because it is also what Apply writes — the thing on screen
     * and the thing that would be saved are one document, so there is nothing to be surprised by.
     */
    const drawn = useMemo(() => {
        if (!mei || !source) return undefined;
        if (!run || !performance) return { mei, recording: source };

        const pairs = toMatches(run.result.matches, minConfidence).filter(
            (pair) => !run.hidden.has(pair.score_id),
        );
        try {
            return {
                mei: applyAlignment(mei, performance.midi, pairs, {
                    source,
                    divergences,
                    resolutions,
                }),
                recording: source,
            };
        } catch (reason: unknown) {
            // This runs while rendering, where a throw takes the desk down with it
            return {
                mei: undefined,
                recording: source,
                failed: `The alignment could not be written into the score. ${
                    reason instanceof Error ? reason.message : String(reason)
                }`,
            };
        }
    }, [mei, source, run, performance, minConfidence, divergences, resolutions]);

    const resolved = useMemo(() => new Set(resolutions.keys()), [resolutions]);
    const marks = useMemo(
        () => marksOf(divergences, alignment?.spans ?? [], resolved),
        [divergences, alignment, resolved],
    );

    const painting = useMemo(
        () =>
            paintingOf({
                matches: alignment?.matches ?? [],
                deletions: alignment?.deletions ?? [],
                divergences,
                minConfidence,
                hidden: run?.hidden ?? new Set(),
            }),
        [alignment, divergences, minConfidence, run],
    );

    const paint = useCallback(
        (element: HTMLElement) => {
            paintAlignment(element, painting, selected);
        },
        [painting, selected],
    );

    const options = useMemo(
        () => ({
            ...performedOptions,
            performanceAlignment: performed,
            performanceRuler: performed,
            performanceScale: scale,
            performanceRecording: drawn?.recording ?? '',
        }),
        [performed, scale, drawn],
    );

    // ── listening back ────────────────────────────────────────────

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
                      },
                  ],
        );
    }, [performance]);

    /** The written note each played note was matched to, for following by ear. */
    const matchedTo = useMemo(
        () => new Map((alignment?.matches ?? []).map((m) => [m.performanceId, m.scoreId])),
        [alignment],
    );

    /**
     * What to light up while a played note sounds.
     *
     * The ids in the stream are the *performed* notes' own, because the performance is what is
     * playing. A note that was matched lights the written note it was matched to; one that was not
     * lights the cross drawn where it was played, which is the only mark on the page that is it.
     */
    const elementFor = useCallback(
        (performanceId: string) => {
            if (!root) return null;
            const escaped = (id: string) =>
                typeof CSS?.escape === 'function' ? CSS.escape(id) : id;
            const scoreId = matchedTo.get(performanceId);
            return scoreId
                ? root.querySelector(`[data-id="${escaped(scoreId)}"]`)
                : root.querySelector(`[data-perf-id="${escaped(performanceId)}"]`);
        },
        [root, matchedTo],
    );

    const playback = useRecordingPlayback({
        notes: alignment?.spans ?? [],
        pedals,
        elementFor,
    });

    // ── the two gestures ──────────────────────────────────────────

    const align = useCallback(
        async (allowMismatch = false) => {
            if (!mei || !performance || !source) return;

            setError(undefined);
            setMismatch(undefined);
            setSelected(undefined);
            setAnchor(undefined);

            try {
                const fresh = await runAlignment({
                    mei,
                    midi: performance.midi,
                    model,
                    allowMismatch,
                    onStatus: setStatus,
                });
                setRun(fresh);
                setScoreNotes(fresh.scoreNotes);
                setNotices(fresh.notices);

                // The settings the run was made with, recorded as soon as it has been made: a
                // decision taken about it in the next minute has to have somewhere to go.
                setAlignment({
                    source,
                    midi: performance.name,
                    model,
                    minConfidence,
                    resolutions,
                    resp: attribution.resp,
                    certainty: attribution.certainty,
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
        [mei, performance, source, model, minConfidence, resolutions, attribution, setAlignment],
    );

    /**
     * Write what is on screen into the two documents.
     *
     * The score first, because a decision that changes the notation changes what the next
     * alignment is *of*: a note written in is a note the model can match rather than report as an
     * addition all over again.
     */
    const apply = useCallback(() => {
        if (!drawn?.mei || !source) return;

        const edited = applyToScore({
            mei: drawn.mei,
            divergences,
            resolutions,
            spans: alignment?.spans ?? [],
            attribution,
        });

        setMei(edited.mei);
        setRun(undefined);
        setNotices(
            edited.changed > 0
                ? [
                      `${String(edited.changed)} decision${edited.changed === 1 ? '' : 's'} ` +
                          `written into the score. Align again to see how the new notation matches.`,
                  ]
                : [],
        );
    }, [drawn, source, divergences, resolutions, alignment, attribution, setMei]);

    const resolve = useCallback(
        (id: string, resolution: Resolution) => {
            if (!recorded) return;
            setAlignment({
                ...recorded,
                resolutions: new Map([...recorded.resolutions, [id, resolution]]),
            });
        },
        [recorded, setAlignment],
    );

    const setAttribution = useCallback(
        (next: Partial<Attribution>) => {
            if (!recorded) return;
            setAlignment({ ...recorded, resp: next.resp ?? recorded.resp, certainty: next.certainty ?? recorded.certainty });
        },
        [recorded, setAlignment],
    );

    // ── moving through the review ─────────────────────────────────

    const undecided = useMemo(
        () => divergences.filter((divergence) => !resolutions.has(divergence.id)),
        [divergences, resolutions],
    );

    /**
     * Move to the next one that has not been settled, and scroll it into view.
     *
     * A disagreement whose notes the engraving never draws — a repeat shown once, a note verovio
     * placed nowhere — is skipped rather than opened on nothing.
     */
    const goToNext = useCallback(() => {
        if (!root) return;

        for (const divergence of undecided.filter((entry) => entry.id !== selected)) {
            // Not a note that has been taken out and bracketed: it is still in the layout, so it
            // would answer the query and then scroll nowhere and anchor the question to a point
            // of no size
            const element = root.querySelector(
                `[data-divergence="${divergence.id}"]:not([data-omitted])`,
            );
            if (!element) continue;

            element.scrollIntoView({ block: 'center', inline: 'center' });
            setSelected(divergence.id);
            setAnchor(element);
            return;
        }

        setSelected(undefined);
        setAnchor(undefined);
    }, [root, undecided, selected]);

    /**
     * Open the question at the note it is about.
     *
     * Every disagreement is somewhere in this score already — a cross where an extra note was
     * played, a red notehead where a written one was not — so the click that asks about one is
     * the click on it.
     */
    const onScoreClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const element = (event.target as Element).closest('[data-divergence]');
        const id = element?.getAttribute('data-divergence');

        // The popover lets clicks through to the music beneath it, so a click on ordinary
        // notation is what closes it
        if (!id || !element) {
            setSelected(undefined);
            setAnchor(undefined);
            return;
        }
        setSelected(id);
        setAnchor(element);
    }, []);

    // ── what the toolbar says ─────────────────────────────────────

    const busy = status !== undefined;
    const pendingEdits = divergences.filter((divergence) =>
        changesNotation(resolutions.get(divergence.id)?.action ?? 'record'),
    ).length;

    const alignTooltip = !performance
        ? 'Open a MIDI recording of this score first'
        : busy
          ? 'The model is running'
          : `Align ${performance.name} against this score`;

    const applyTooltip = !drawn?.mei
        ? 'Nothing to write yet'
        : !run
          ? 'The score already holds this alignment'
          : pendingEdits > 0
            ? `Write the alignment and ${String(pendingEdits)} decisions into the score`
            : 'Write the alignment into the score';

    const label =
        divergences.length > 0
            ? `${String(undecided.length)} of ${String(divergences.length)} undecided`
            : '—';

    if (!mei) return null;

    return (
        <>
            <GlobalStyles styles={alignmentStyles(EXTRA_COLOUR, OMITTED_COLOUR)} />

            <DeskToolbar>
                <ToolGroup label="View">
                    <Box
                        component="select"
                        aria-label="Layout"
                        value={performed ? 'performed' : 'notated'}
                        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                            setPerformed(event.target.value === 'performed');
                        }}
                        sx={{ height: 30, borderRadius: 1, border: '1px solid #e5e7eb' }}
                    >
                        <option value="performed">Performed</option>
                        <option value="notated">Notated</option>
                    </Box>
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
                        disabled={!performed}
                    />
                </ToolGroup>

                <ToolGroup label="Settings">
                    <Box
                        component="select"
                        aria-label="Recording"
                        value={source ?? ''}
                        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                            setPicked(event.target.value);
                            setRun(undefined);
                        }}
                        sx={{ height: 30, borderRadius: 1, border: '1px solid #e5e7eb' }}
                    >
                        {sources.length === 0 && <option value="">No recording</option>}
                        {sources.map((entry) => (
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
                    <Box
                        component="select"
                        aria-label="Model"
                        value={model}
                        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                            setModel(event.target.value as MlignModelId);
                        }}
                        sx={{ height: 30, borderRadius: 1, border: '1px solid #e5e7eb' }}
                    >
                        {Object.entries(MLIGN_MODELS).map(([id, entry]) => (
                            <option key={id} value={id}>
                                {entry.label}
                            </option>
                        ))}
                    </Box>
                    <Slider
                        aria-label="Least confidence"
                        sx={{ width: '5rem', mx: 1 }}
                        min={0}
                        max={0.95}
                        step={0.05}
                        value={sliderValue}
                        onChange={(_, value) => {
                            setSliderValue(value as number);
                        }}
                        onChangeCommitted={(_, value) => {
                            setMinConfidence(value as number);
                        }}
                        disabled={!run}
                    />
                    <ToolField
                        label="Decided by"
                        width={96}
                        value={attribution.resp}
                        onChange={(value) => {
                            setAttribution({ resp: value });
                        }}
                    />
                    <Box
                        component="select"
                        aria-label="Certainty"
                        value={attribution.certainty}
                        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                            setAttribution({ certainty: event.target.value });
                        }}
                        sx={{ height: 30, borderRadius: 1, border: '1px solid #e5e7eb' }}
                    >
                        {CERTAINTIES.map((certainty) => (
                            <option key={certainty} value={certainty}>
                                {certainty}
                            </option>
                        ))}
                    </Box>
                </ToolGroup>

                <ToolGroup>
                    <ToolbarButton
                        label="Align"
                        tooltip={alignTooltip}
                        disabled={!performance || busy}
                        onClick={() => void align()}
                    >
                        {run ? 'Align again' : 'Align'}
                    </ToolbarButton>
                    <ToolStatus width={132}>{status ? status.text : label}</ToolStatus>
                    <ToolbarButton
                        label="Go to next"
                        tooltip={
                            undecided.length > 0
                                ? 'Open the next disagreement nobody has settled'
                                : 'Nothing left undecided'
                        }
                        disabled={undecided.length === 0}
                        onClick={goToNext}
                    >
                        Next
                    </ToolbarButton>
                    <ToolbarButton
                        primary
                        label="Apply"
                        tooltip={applyTooltip}
                        disabled={!run || !drawn?.mei || busy}
                        onClick={apply}
                    >
                        Apply
                    </ToolbarButton>
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
                    <Alert severity="warning" key={notice}>
                        {notice}
                    </Alert>
                ))}

                {drawn?.failed && <Alert severity="error">{drawn.failed}</Alert>}

                {/* Only where there is a recording to hear. A transport over nothing, with a
                    sentence under it about notes lighting up, is an offer that cannot be taken. */}
                {(alignment?.spans.length ?? 0) > 0 && (
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                        <PlaybackBar playback={playback} />
                        <Typography variant="body2" color="text.secondary">
                            Listen back, and the notes light up as they sound. Drag either end of
                            the bar to hear one passage on its own.
                        </Typography>
                    </Stack>
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
                    {drawn?.mei ? (
                        <Score
                            className="alignment-score"
                            mei={drawn.mei}
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
                                This score has no recording in it. Add a MIDI performance of it and
                                press Align: the two are put note against note here, and every
                                other desk reads what comes out.
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                The matching is worked out in the browser, note by note. It is a
                                proposal — what the score and the recording disagree about is
                                yours to read, and nothing is written into the score until you
                                press Apply.
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

            <DivergencePopover
                divergence={divergences.find((divergence) => divergence.id === selected)}
                anchor={anchor}
                resolution={selected ? resolutions.get(selected) : undefined}
                onResolve={resolve}
                onClose={() => {
                    setSelected(undefined);
                    setAnchor(undefined);
                }}
                onNext={goToNext}
                remaining={undecided.length}
            />
        </>
    );
};
