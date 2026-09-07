import { useCallback, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Check, Clear } from '@mui/icons-material';
import type { ScopedTransformerViewProps } from '../TransformerViewProps';
import { Modify, type ModifyOptions } from '../../fitting/transformers/modification/Modify';
import { CorrectPedal } from '../../fitting/transformers/modification/CorrectPedal';
import { sameTravel } from '../../performance/pedalTravel';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { coveredBy, useEventSelection } from './useEventSelection';
import { useModifyDeltas } from './useModifyDeltas';
import { useLineGhosts } from './useLineGhosts';
import type { LineDraft } from './lineDraft';
import { VelocityPlot } from './VelocityPlot';
import { TimingRoll, type TimingAspect, type TimingPreview } from './TimingRoll';

/** Which plot is in front, and so which of the recording's properties is being corrected. */
type Plot = 'velocity' | 'timing';

/** A shift of the selected events in one aspect, or one press's line as drafted. */
type Draft = { aspect: ModifyOptions['aspect']; change: number } | LineDraft;

/** The call sent and not yet answered by a fit. */
type Pending = { call: 'Modify'; options: ModifyOptions } | { call: 'CorrectPedal'; draft: LineDraft };

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
 */
export const CorrectionsDesk = ({
    part,
    msm,
    addTransformer,
}: ScopedTransformerViewProps<Modify | CorrectPedal>) => {
    const [plot, setPlot] = useState<Plot>('velocity');
    const [draft, setDraft] = useState<Draft>();
    const [pending, setPending] = useState<Pending>();

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
            clear();
        }
        setLastFit({ msm, part });
    }

    const pendingModify = pending?.call === 'Modify' ? pending.options : undefined;
    const velocityGhosts = useModifyDeltas(msm, part, 'velocity', pendingModify);
    const onsetGhosts = useModifyDeltas(msm, part, 'onset', pendingModify);
    const durationGhosts = useModifyDeltas(msm, part, 'duration', pendingModify);
    const lineGhosts = useLineGhosts(msm, onsetGhosts);

    const preview: Draft | undefined = pending
        ? pending.call === 'Modify'
            ? pending.options
            : pending.draft
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
            </DeskToolbar>

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
