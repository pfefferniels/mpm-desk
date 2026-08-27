import { useState } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Check, Clear } from '@mui/icons-material';
import type { ScopedTransformerViewProps } from '../TransformerViewProps';
import { Modify, type ModifyOptions } from '../../fitting/transformers/modification/Modify';
import { DeskToolbar } from '../../components/DeskToolbar';
import { ToolGroup } from '../../components/toolbar/ToolGroup';
import { ToolbarButton } from '../../components/toolbar/ToolbarButton';
import { ToolStatus } from '../../components/toolbar/ToolStatus';
import { coveredBy, useEventSelection } from './useEventSelection';
import { useModifyDeltas } from './useModifyDeltas';
import { VelocityPlot } from './VelocityPlot';
import { TimingRoll, type TimingAspect } from './TimingRoll';

/** Which plot is in front, and so which of the recording's properties is being corrected. */
type Plot = 'velocity' | 'timing';

const signed = (change: number) => `${change > 0 ? '+' : ''}${String(change)}`;

const count = (n: number, what: string) => `${String(n)} ${what}${n === 1 ? '' : 's'}`;

/**
 * Corrections to the recording.
 *
 * ## What this desk is not
 *
 * It writes no performance instruction. `Modify` is one of the three calls that edit the *ground*
 * a performance is fitted to rather than the performance itself — `MakeChoice` picks between the
 * readings of a passage, this corrects the reading that was picked, `InsertMetadata` says who did
 * the picking — and none of the three puts anything in the MPM. That is why they are grouped
 * together in the aspect menu, away from the twelve desks that write instructions, and why
 * nothing here appears in the narrative: a correction is not a claim about the performance, it is
 * a statement that the roll scan read something wrong.
 *
 * It lived inside the dynamics desk until now, as a third mode of it, which put a correction to
 * the recording behind the desk for fitting curves *over* the recording and left three of the
 * four things `Modify` can correct with nowhere to be made from at all.
 *
 * ## The selector says what, the grab says which property
 *
 * One click model over two plots. What was clicked becomes the call's selector — a list of note
 * ids, a stretch of the tick grid, a list of pedal ids — and where it was grabbed becomes the
 * aspect: a dot on the velocity plot can only be dragged up and down, and on the roll the body of
 * an event is its attack while its right edge is its release. So the two questions a `Modify`
 * asks are answered by two different parts of the same gesture, and neither needs a control.
 *
 * A drag is a *draft*: nothing is sent until Apply, and until then the displaced events and the
 * blue ghost behind them are the whole of the preview.
 */
export const CorrectionsDesk = ({
    part,
    msm,
    addTransformer,
}: ScopedTransformerViewProps<Modify>) => {
    const [plot, setPlot] = useState<Plot>('velocity');
    const [draft, setDraft] = useState<{ aspect: ModifyOptions['aspect']; change: number }>();
    const [pending, setPending] = useState<ModifyOptions>();

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

    const velocityGhosts = useModifyDeltas(msm, part, 'velocity', pending);
    const onsetGhosts = useModifyDeltas(msm, part, 'onset', pending);
    const durationGhosts = useModifyDeltas(msm, part, 'duration', pending);

    const preview = pending ?? draft;
    const previewIds = pending ? coveredBy(pending, msm, part) : selected;

    /** What the selection covers, said beside the button rather than inside its label. */
    const scopeLabel = !selection
        ? 'nothing'
        : 'noteIDs' in selection
          ? count(selection.noteIDs.length, 'note')
          : 'pedalIDs' in selection
            ? count(selection.pedalIDs.length, 'pedal')
            : `ticks ${String(selection.from)}–${String(selection.to)}`;

    const unit = draft?.aspect === 'velocity' ? '' : ' ms';
    const readout = draft && draft.change !== 0 ? `${signed(draft.change)}${unit}` : '—';

    const commit = () => {
        if (!selection || !draft || draft.change === 0) return;

        const options: ModifyOptions = {
            ...selection,
            scope: part,
            aspect: draft.aspect,
            change: draft.change,
        };

        addTransformer(new Modify(options));
        setPending(options);
        setDraft(undefined);
        clear();
    };

    const applyTooltip = !selection
        ? 'Click an event on the plot to say what the correction is about'
        : !draft || draft.change === 0
          ? 'Drag a selected event first — there is no correction to apply'
          : `Add ${signed(draft.change)}${unit} to the ${draft.aspect} of ${scopeLabel}`;

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
                            // milliseconds on the other.
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
                        label="Apply correction"
                        tooltip={applyTooltip}
                        disabled={!selection || !draft || draft.change === 0}
                        onClick={commit}
                    >
                        Apply
                    </ToolbarButton>
                    {/* Sized for `+1200 ms`, and held at that width: the readout is beside the
                        button the user is aiming for, and a value that grows a digit mid-drag
                        would move the button out from under the cursor. */}
                    <ToolStatus width={64}>{readout}</ToolStatus>
                    <ToolStatus width={104}>{scopeLabel}</ToolStatus>
                    <ToolbarButton
                        icon={<Clear fontSize="small" />}
                        label="Clear selection"
                        tooltip={
                            selection
                                ? 'Forget the selected events and the correction drawn on them'
                                : 'Nothing selected to clear'
                        }
                        disabled={!selection}
                        onClick={() => {
                            setDraft(undefined);
                            clear();
                        }}
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
                    preview={
                        preview && preview.aspect !== 'velocity'
                            ? { aspect: preview.aspect, change: preview.change }
                            : undefined
                    }
                    previewIds={previewIds}
                    onsetGhosts={onsetGhosts}
                    durationGhosts={durationGhosts}
                />
            )}
        </div>
    );
};
