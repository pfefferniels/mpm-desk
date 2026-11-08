import { useCallback, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Check, Clear, UnfoldMore } from '@mui/icons-material';
import type { ScopedTransformerViewProps } from '../TransformerViewProps';
import { Modify, type ModifyOptions } from '../../fitting/transformers/modification/Modify';
import { CorrectPedal } from '../../fitting/transformers/modification/CorrectPedal';
import { Expand, type ExpandOptions } from '../../fitting/transformers/modification/Expand';
import { sameTravel } from '../../performance/pedalTravel';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { coveredBy, useEventSelection } from './useEventSelection';
import { useCorrectionDeltas } from './useCorrectionDeltas';
import { useLineGhosts } from './useLineGhosts';
import type { LineDraft } from './lineDraft';
import { VelocityPlot } from './VelocityPlot';
import { TimingRoll, type TimingAspect, type TimingPreview } from './TimingRoll';
import { ExpandDialog } from './ExpandDialog';

/** Which plot is in front, and so which of the recording's properties is being corrected. */
type Plot = 'velocity' | 'timing';

/** A shift of the selected events in one aspect, or one press's line as drafted. */
type Draft = { aspect: ModifyOptions['aspect']; change: number } | LineDraft;

/** The call sent and not yet answered by a fit. */
type Pending =
    | { call: 'Modify'; options: ModifyOptions }
    | { call: 'CorrectPedal'; draft: LineDraft }
    | { call: 'Expand'; id: string };

const signed = (change: number) => `${change > 0 ? '+' : ''}${String(change)}`;

const count = (n: number, what: string) => `${String(n)} ${what}${n === 1 ? '' : 's'}`;

/** Whether the drafted line says anything the recording does not. */
const lineChanged = ({ change, before }: LineDraft): boolean =>
    before === null || 'remove' in change || !sameTravel(before, change.travel);

const lineLabel = ({ change, before }: LineDraft): string =>
    'remove' in change
        ? 'Remove 1 pedal'
        : before === null && 'type' in change
          ? `Add 1 ${change.type} pedal`
          : 'Apply line to 1 pedal';

const lineTooltip = ({ change, before }: LineDraft): string =>
    'remove' in change
        ? 'Drop the press from the recording'
        : before === null && 'type' in change
          ? `Add a ${change.type} press the roll lacks`
          : 'Redraw the line of the press';

/**
 * Corrections to the recording.
 *
 * ## What this desk is not
 *
 * It writes no performance instruction. `Modify` and `CorrectPedal` are among the calls that edit
 * the *ground* a performance is fitted to rather than the performance itself: `MakeChoice` picks
 * between the readings of a passage, these correct the reading that was picked, and
 * `InsertMetadata` says who did the picking. None of them puts anything in the MPM, which is why
 * they are grouped together in the aspect menu and why nothing here appears in the narrative. A
 * correction states that the roll scan read something wrong rather than claiming anything about
 * the performance.
 *
 * ## The selector says what, the grab says which property
 *
 * One click model over two plots. What was clicked becomes the call's selector — a list of note
 * ids, a stretch of the tick grid, a list of pedal ids — and where it was grabbed becomes the
 * aspect: a dot on the velocity plot can only be dragged up and down, and on the roll the body of
 * an event is its attack while its right edge is its release. So the two questions a `Modify`
 * asks are answered by two different parts of the same gesture, and neither needs a control.
 *
 * A pedal's line is the third kind of grab: a handle on it, a flat run of it, or the lane it is
 * missing from. Those make a `CorrectPedal`, which is about one press and states its whole line.
 *
 * A drag is a *draft*: nothing is sent until Apply, and until then the displaced events and the
 * blue ghost behind them are the whole of the preview.
 *
 * ## Expand, typed rather than dragged
 *
 * The one call here that is not a gesture. An `Expand` maps a range of recorded values onto
 * another — the roll's softest velocity to a softer one, its loudest to somewhat less — so it is
 * stated as points in a dialog. It takes the selection as its selector, as a `Modify` would, and
 * with nothing selected it is about every event of the part: the case it is made for, a claim
 * about the scale the whole roll was recorded on.
 */
export const CorrectionsDesk = ({
    part,
    msm,
    addTransformer,
}: ScopedTransformerViewProps<Modify | CorrectPedal | Expand>) => {
    const [plot, setPlot] = useState<Plot>('velocity');
    const [draft, setDraft] = useState<Draft>();
    const [pending, setPending] = useState<Pending>();
    const [expanding, setExpanding] = useState(false);

    const { selection, select, clear, selected } = useEventSelection(msm, part);

    // The optimistic preview is answered by the next fit: once the corrected value is in `msm`
    // there is nothing left to preview, and the call's own grey ghost takes over. Adjusted during
    // render — React's way of reacting to a changed prop — rather than in an effect, which would
    // commit the stale preview over the new fit for one frame.
    const [lastFit, setLastFit] = useState({ msm, part });
    if (lastFit.msm !== msm || lastFit.part !== part) {
        setPending(undefined);
        if (lastFit.part !== part) {
            setDraft(undefined);
            setExpanding(false);
            clear();
        }
        setLastFit({ msm, part });
    }

    const pendingModify = pending?.call === 'Modify' ? pending.options : undefined;
    const unfitted = pending?.call === 'Expand' ? pending.id : undefined;
    const velocityGhosts = useCorrectionDeltas(msm, part, 'velocity', pendingModify, unfitted);
    const onsetGhosts = useCorrectionDeltas(msm, part, 'onset', pendingModify, unfitted);
    const durationGhosts = useCorrectionDeltas(msm, part, 'duration', pendingModify, unfitted);
    const lineGhosts = useLineGhosts(msm, onsetGhosts);

    const preview: Draft | undefined = pending
        ? pending.call === 'Modify'
            ? pending.options
            : pending.call === 'CorrectPedal'
              ? pending.draft
              : undefined
        : draft;
    const previewIds = pendingModify ? coveredBy(pendingModify, msm, part) : selected;
    const timingPreview: TimingPreview | undefined =
        preview && preview.aspect !== 'velocity'
            ? preview.aspect === 'line'
                ? preview
                : { aspect: preview.aspect, change: preview.change }
            : undefined;

    /** What the selection covers, or nothing at all while there is no selection to describe. */
    const scopeLabel = !selection
        ? undefined
        : 'noteIDs' in selection
          ? count(selection.noteIDs.length, 'note')
          : 'pedalIDs' in selection
            ? count(selection.pedalIDs.length, 'pedal')
            : `ticks ${String(selection.from)}–${String(selection.to)}`;

    const shift = draft && draft.aspect !== 'line' ? draft : undefined;
    const unit = shift?.aspect === 'velocity' ? '' : ' ms';
    const correction = shift && shift.change !== 0 ? `${signed(shift.change)}${unit}` : undefined;
    const line = draft?.aspect === 'line' && lineChanged(draft) ? draft : undefined;

    /**
     * The button says the whole sentence: what will be added, and to what.
     *
     * It grows and shrinks as the drag proceeds, which a bar of fixed-width readouts exists to
     * avoid — but the cursor is on the plot for the whole of that drag, and by the time it comes
     * looking for the button the wording has settled.
     */
    const applyLabel = line
        ? lineLabel(line)
        : !scopeLabel
          ? 'Apply'
          : correction
            ? `Apply ${correction} to ${scopeLabel}`
            : `Apply to ${scopeLabel}`;

    const clearAll = useCallback(() => {
        setDraft(undefined);
        clear();
    }, [clear]);

    // The plots have no focusable element to hang this on, so it is bound on the document — as on
    // the voices desk, where Escape likewise drops what is picked wherever the pointer is.
    useHotkeys('escape', clearAll, [clearAll]);

    const commit = () => {
        if (line) {
            addTransformer(new CorrectPedal(line.change));
            setPending({ call: 'CorrectPedal', draft: line });
            setDraft(undefined);
            clear();
            return;
        }
        if (!selection || !shift || shift.change === 0) return;

        const options: ModifyOptions = {
            ...selection,
            scope: part,
            aspect: shift.aspect,
            change: shift.change,
        };

        addTransformer(new Modify(options));
        setPending({ call: 'Modify', options });
        setDraft(undefined);
        clear();
    };

    // An expansion reaches the selection, or every event of the part. On the velocity plot that
    // is the notes alone; on the roll the pedals too, where the desk is on the whole piece rather
    // than on one part — as `Expand` itself has it.
    const expandAspects: readonly ExpandOptions['aspect'][] =
        plot === 'velocity' ? ['velocity'] : ['onset', 'duration'];
    const pedalsOnly = selection !== undefined && 'pedalIDs' in selection;
    const expandAbout =
        scopeLabel ?? (plot === 'timing' && part === 'global' ? 'every note and pedal' : 'every note');

    /** The lowest and highest value the expansion would reach, to open the dialog on. */
    const recorded = (aspect: ExpandOptions['aspect']): [number, number] => {
        const ids = selection ? coveredBy(selection, msm, part) : undefined;
        const reached = (id: string) => !ids || ids.has(id);
        const notes = msm.in(part).notes().filter((n) => reached(n['xml:id']));
        const pedals =
            aspect === 'velocity' || (!ids && part !== 'global')
                ? []
                : msm.pedals.filter((p) => reached(p['xml:id']));
        const values = [...notes, ...pedals]
            .map((event) =>
                aspect === 'onset'
                    ? event['milliseconds.date']
                    : aspect === 'duration'
                      ? event['milliseconds.date.end'] - event['milliseconds.date']
                      : 'velocity' in event
                        ? event.velocity
                        : NaN,
            )
            .filter(Number.isFinite);
        if (values.length === 0) return [0, 1];
        const low = Math.floor(Math.min(...values));
        const high = Math.ceil(Math.max(...values));
        return [low, high > low ? high : low + 1];
    };

    const expand = (aspect: ExpandOptions['aspect'], points: ExpandOptions['points']) => {
        const call = new Expand({ ...(selection ?? {}), scope: part, aspect, points });
        addTransformer(call);
        // Not drawn ahead of the fit, unlike a shift: where each event lands depends on the map.
        // So the call is only held out of the ghosts until the fit shows what it did.
        setPending({ call: 'Expand', id: call.id });
        setExpanding(false);
        setDraft(undefined);
        clear();
    };

    const applyTooltip = line
        ? lineTooltip(line)
        : !scopeLabel
          ? 'Click an event on the plot to say what the correction is about'
          : !shift || !correction
            ? 'Drag a selected event first — there is no correction to apply'
            : `Add ${correction} to the ${shift.aspect} of ${scopeLabel}`;

    return (
        <div>
            <DeskToolbar>
                <ToolGroup label="Plot">
                    <ToggleButtonGroup
                        value={plot}
                        exclusive
                        // An exclusive group answers a click on the pressed button with `null`,
                        // and this desk has no "no plot" — dropping that click leaves the switch
                        // where it was, which is what a two-way switch should do.
                        onChange={(_, next: Plot | null) => {
                            if (next === null || next === plot) return;
                            // The selection carries over — the same events are on both plots —
                            // but a draft cannot: its `change` is velocity steps on one plot and
                            // milliseconds or a line on the other.
                            setDraft(undefined);
                            setPlot(next);
                        }}
                        size="small"
                    >
                        <ToggleButton value="velocity">Velocity</ToggleButton>
                        <ToggleButton value="timing">Timing</ToggleButton>
                    </ToggleButtonGroup>
                </ToolGroup>

                <ToolGroup>
                    <ToolbarButton
                        primary
                        icon={<Check />}
                        label={applyLabel}
                        tooltip={applyTooltip}
                        disabled={!line && (!scopeLabel || !correction)}
                        onClick={commit}
                    >
                        {applyLabel}
                    </ToolbarButton>
                    <ToolbarButton
                        icon={<Clear fontSize="small" />}
                        label="Clear selection"
                        tooltip={
                            selection
                                ? 'Forget the selected events and the correction drawn on them (Esc)'
                                : 'Nothing selected to clear'
                        }
                        disabled={!selection}
                        onClick={clearAll}
                    >
                        Clear
                    </ToolbarButton>
                </ToolGroup>

                <ToolGroup>
                    <ToolbarButton
                        icon={<UnfoldMore fontSize="small" />}
                        label="Expand…"
                        tooltip={
                            plot === 'velocity' && pedalsOnly
                                ? 'A pedal has no velocity to expand'
                                : `Map a range of recorded values onto another, for ${expandAbout}`
                        }
                        disabled={plot === 'velocity' && pedalsOnly}
                        onClick={() => setExpanding(true)}
                    >
                        Expand…
                    </ToolbarButton>
                </ToolGroup>
            </DeskToolbar>

            {expanding && (
                <ExpandDialog
                    about={expandAbout}
                    aspects={expandAspects}
                    recorded={recorded}
                    onClose={() => setExpanding(false)}
                    onApply={expand}
                />
            )}

            {plot === 'velocity' ? (
                <VelocityPlot
                    msm={msm}
                    part={part}
                    selected={selected}
                    onSelect={select}
                    onDrag={(change) => setDraft({ aspect: 'velocity', change })}
                    preview={preview?.aspect === 'velocity' ? preview.change : 0}
                    previewIds={previewIds}
                    ghosts={velocityGhosts}
                    range={
                        selection && !('noteIDs' in selection) && !('pedalIDs' in selection)
                            ? { from: selection.from, to: selection.to }
                            : undefined
                    }
                />
            ) : (
                <TimingRoll
                    msm={msm}
                    part={part}
                    selected={selected}
                    onSelect={select}
                    onDrag={(aspect: TimingAspect, change) => setDraft({ aspect, change })}
                    onDraw={setDraft}
                    preview={timingPreview}
                    previewIds={previewIds}
                    onsetGhosts={onsetGhosts}
                    durationGhosts={durationGhosts}
                    lineGhosts={lineGhosts}
                />
            )}
        </div>
    );
};
