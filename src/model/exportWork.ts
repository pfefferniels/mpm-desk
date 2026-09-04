/**
 * Saving: everything that happens between the button and the bytes.
 *
 * This lived in the app bar, inside the component that draws the Save icon, which meant the code
 * that writes somebody's only copy of a reconstruction could not be run without mounting a
 * toolbar. Nothing about it is a toolbar's business: it is three pure steps and a zip — the score
 * gets the choices folded into it, the chain gets what the run made it answerable for folded onto
 * it, and four files go into a bag.
 *
 * So it sits here, next to {@link serializeWorkFile}, which it calls, and next to the reducer
 * whose document it writes. The one part that genuinely belongs to the browser — handing the blob
 * to the user — stays with the caller; see {@link buildWorkArchive}.
 */

import type { AlignedNote, Alignment } from '../fitting/alignment';
import { exportMPM, type Mpm } from '../fitting/instructions/index';
import type { MakeChoiceOptions } from '../fitting/transformers/choice/MakeChoice';
import { serializeWorkFile, type Call, type Segment, type WorkFile } from './Work';
import type { CallOutcome } from './Reconstruction';
import type { WorkMetadata } from './workReducer';
import JSZip from 'jszip';

/**
 * Fold every `MakeChoice` in the chain into the MEI, as `@corresp` on the notes it chose for.
 *
 * An aligned MEI states each reading as a `<recording>` of `<when>` elements, one per sounded
 * note, pointing at the `<note>` it realises through `@data` and at the symbol it was transcribed
 * from through `@corresp`. Which reading a passage was taken from is otherwise only in the chain,
 * as a `MakeChoice` option, so reading it back means running the transformers again. Writing the
 * chosen `@corresp` onto the `<note>` puts the answer in the score itself.
 *
 * **The first choice that covers a note decides it.** A note already carrying `@corresp` is left
 * alone, so a later call cannot overwrite an earlier one's answer, which makes a whole-piece
 * choice a fallback rather than a reset when a ranged one ran before it.
 *
 * A choice naming a source no `<recording>` has is skipped rather than raised: the chain may name
 * a take this MEI does not carry, and refusing to save is a worse answer than saving a score that
 * stays silent about which reading it holds.
 *
 * `removeRecordings` strips the alternative readings out afterwards. The archive keeps every
 * take, dropping them leaving the export unable to state what the choice was between, but an
 * export meant for a reader rather than for reopening would want it.
 */
export const injectChoices = (
    mei: string,
    msm: Alignment,
    choices: readonly MakeChoiceOptions[],
    removeRecordings = false,
): string => {
    const meiDoc = new DOMParser().parseFromString(mei, 'application/xml');

    for (const choice of choices) {
        const notesAffectedByChoice: AlignedNote[] = [];

        if ('from' in choice && 'to' in choice) {
            notesAffectedByChoice.push(
                ...msm.allNotes.filter((n) => n.date >= choice.from && n.date < choice.to),
            );
        } else if ('noteIDs' in choice) {
            notesAffectedByChoice.push(
                ...msm.allNotes.filter((n) => choice.noteIDs.includes(n['xml:id'])),
            );
        } else {
            notesAffectedByChoice.push(...msm.allNotes);
        }

        const preferredSources =
            'prefer' in choice ? [choice.prefer] : [choice.velocity, choice.timing];
        const prefer = preferredSources.join(' ');
        const recording = meiDoc.querySelector(`recording[source="${prefer}"]`);
        if (!recording) continue;

        const relevantWhens = notesAffectedByChoice
            .map((n) => meiDoc.querySelector(`when[data="#${n['xml:id']}"]`))
            .filter((when) => when !== null) as Element[];

        for (const when of relevantWhens) {
            const data = when.getAttribute('data')!.slice(1);
            const note = meiDoc.querySelector(`note[*|id="${data}"]`);
            if (!note) continue;
            if (note.hasAttribute('corresp')) continue;
            const corresp = when.getAttribute('corresp');
            if (!corresp) continue;
            note.setAttribute('corresp', corresp);
        }
    }

    if (removeRecordings) {
        const recordings = meiDoc.querySelectorAll('recording');
        for (const recording of recordings) {
            recording.remove();
        }
    }

    return new XMLSerializer().serializeToString(meiDoc);
};

/**
 * The provenance as the file records it: each call, plus what the run made it answerable for.
 *
 * Two of a {@link Call}'s fields cannot be derived from its options, so whoever ran the chain
 * writes them down: the `elements` it wrote or reshaped, and the `range` of score it acted on.
 * Only a run knows either, a call's elements being a before-and-after difference and a recorded
 * pedal having no symbolic date. `Call` documents both at length.
 *
 * **Folded in only where the run has something to say.** An outcome with no elements and a null
 * range leaves the call as the document held it, so a call that wrote nothing this time keeps
 * what a previous save recorded. A call the chain could not run is better left saying what it
 * last did than silently emptied, which is why the two fields are spread conditionally.
 *
 * A call no outcome mentions is passed through by reference, untouched.
 */
export const provenanceOf = (
    calls: readonly Call[],
    outcomes: readonly CallOutcome[],
): Call[] => {
    const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));

    return calls.map((call) => {
        const outcome = outcomeById.get(call.id);
        return outcome
            ? {
                  ...call,
                  ...(outcome.elements.length > 0 && { elements: [...outcome.elements] }),
                  ...(outcome.range !== null && { range: outcome.range }),
              }
            : call;
    });
};

/** One performance the score was aligned against, as it was opened. */
export interface ArchivedRecording {
    /**
     * The file's own name, which is what an `Align` call records in `midi` — that is the link
     * between a take in here and the decisions made about it.
     */
    name: string;
    bytes: Uint8Array;
}

/** Everything the archive is written out of: the document, the run, and the source files. */
export interface WorkArchiveInput {
    mei: string;
    msm: Alignment;
    mpm: Mpm;
    scoreMsm: string;
    calls: readonly Call[];
    segments: readonly Segment[];
    outcomes: readonly CallOutcome[];
    metadata: WorkMetadata;
    secondary?: WorkFile['secondary'];
    /**
     * The MIDI performances, so that a reopened project can be aligned again.
     *
     * The alignment itself is in `transcription.mei` and needs none of this to be read back — but
     * re-running the model does, and so does anything that wants to hear the recording rather than
     * a rendering of what was made of it. They are the evidence; a few tens of kilobytes each.
     */
    recordings?: readonly ArchivedRecording[];
}

/**
 * Build the archive the viewer reads.
 *
 *   transcription.mei   the score, with the recording aligned into it
 *   work.json           the chain, what each call wrote, and the segment it wrote it under
 *   performance.mpm     the MPM this run produced
 *   score.msm           the MEI converted, so the viewer need not convert
 *   recordings/*.mid    the performances the score was aligned against, where there are any
 *
 * The viewer reads the last three and derives the tree from them. It needs no `segments.json`:
 * every call records its own elements and range, so the projection is a few milliseconds of
 * arithmetic rather than a fourth file that can fall out of step with the first three.
 *
 * **It does not download.** Handing a blob to the user is a DOM act, the one part of saving that
 * needs a browser and has nothing worth checking. Everything above it can silently write the
 * wrong file, so it returns a value and the caller passes that to `downloadAsFile`.
 */
export const buildWorkArchive = async (input: WorkArchiveInput): Promise<Blob> => {
    const newMEI = injectChoices(
        input.mei,
        input.msm,
        input.calls
            .filter((call) => call.name === 'MakeChoice')
            .map((call) => call.options as unknown as MakeChoiceOptions),
    );

    const work: WorkFile = {
        // The title is what the metadata desk wrote, which a reconstruction nobody has named yet
        // does not have. `Reconstruction` is the placeholder rather than an empty string, because
        // this is the name the file states about itself.
        name: input.metadata.title || 'Reconstruction',
        mei: 'transcription.mei',
        mpm: 'performance.mpm',
        provenance: provenanceOf(input.calls, input.outcomes),
        segments: [...input.segments],
        ...(input.secondary !== undefined && { secondary: input.secondary }),
    };

    const zip = new JSZip();
    zip.file('transcription.mei', newMEI);
    zip.file('work.json', serializeWorkFile(work));
    zip.file('performance.mpm', exportMPM(input.mpm));
    zip.file('score.msm', input.scoreMsm);
    for (const recording of input.recordings ?? []) {
        zip.file(`recordings/${recording.name}`, recording.bytes);
    }

    return zip.generateAsync({ type: 'blob' });
};
