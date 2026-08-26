import React, { useCallback } from 'react';
import { Button, IconButton, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { Pause, PlayArrow, Save, UploadFile } from '@mui/icons-material';
import type { Alignment } from '../fitting/alignment';
import { exportMPM, getInstructions, type Mpm } from '../fitting/instructions/index';
import type { MakeChoiceOptions } from '../fitting/transformers/choice/MakeChoice';
import { serializeWorkFile } from '../model/Work';
import type { Call, WorkFile } from '../model/Work';
import type { CallOutcome } from '../model/Reconstruction';
import { SecondaryData } from '../desks/TransformerViewProps';
import { Ribbon } from './Ribbon';
import { usePlayback } from '../hooks/PlaybackProvider';
import { useMode } from '../hooks/ModeProvider';
import { useCallSelection } from '../hooks/CallSelection';
import { useScrollSync } from '../hooks/ScrollSyncProvider';
import { useHotkeys } from 'react-hotkeys-hook';
import { downloadAsFile } from '../utils/utils';
import JSZip from 'jszip';

const injectChoices = (mei: string, msm: Alignment, choices: MakeChoiceOptions[], removeRecordings = false): string => {
    const meiDoc = new DOMParser().parseFromString(mei, 'application/xml')

    for (const choice of choices) {
        const notesAffectedByChoice = []

        if (('from' in choice) && ('to' in choice)) {
            notesAffectedByChoice.push(...msm.allNotes.filter(n => n.date >= choice.from && n.date < choice.to))
        }
        else if ('noteIDs' in choice) {
            notesAffectedByChoice.push(...msm.allNotes.filter(n => choice.noteIDs.includes(n['xml:id'])))
        }
        else {
            notesAffectedByChoice.push(...msm.allNotes)
        }

        const preferredSources = 'prefer' in choice
            ? [choice.prefer]
            : [choice.velocity, choice.timing]
        const prefer = preferredSources.join(' ')
        const recording = meiDoc.querySelector(`recording[source="${prefer}"]`)
        if (!recording) continue

        const relevantWhens = notesAffectedByChoice
            .map(n => meiDoc.querySelector(`when[data="#${n['xml:id']}"]`))
            .filter(when => when !== null) as Element[]

        for (const when of relevantWhens) {
            const data = when.getAttribute('data')!.slice(1)
            const note = meiDoc.querySelector(`note[*|id="${data}"]`)
            if (!note) continue
            if (note.hasAttribute('corresp')) continue
            const corresp = when.getAttribute('corresp')
            if (!corresp) continue
            note.setAttribute('corresp', corresp)
        }
    }

    if (removeRecordings) {
        const recordings = meiDoc.querySelectorAll("recording")
        for (const recording of recordings) {
            recording.remove()
        }
    }

    return new XMLSerializer().serializeToString(meiDoc)
}

interface AppMenuProps {
    mei: string | undefined;
    msm: Alignment;
    mpm: Mpm;
    transformers: Call[];
    segments: WorkFile['segments'];
    scoreMsm: string;
    outcomes: readonly CallOutcome[];
    metadata: { author: string; title: string };
    secondary: SecondaryData;
    scope: 'global' | number;
    setScope: (scope: 'global' | number) => void;
    onFileImport: () => void;
    onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const AppMenu: React.FC<AppMenuProps> = ({
    mei,
    msm,
    mpm,
    transformers,
    segments,
    scoreMsm,
    outcomes,
    metadata,
    secondary,
    scope,
    setScope,
    onFileImport,
    onFileChange,
}) => {
    const { isPlaying, play, stop } = usePlayback();
    const { isEditorMode } = useMode();
    const { setActiveCallIds, callForElement } = useCallSelection();
    const { scrollToDate } = useScrollSync();

    // Follow behavior: update active transformers and scroll position based on playback position.
    const handleNoteEvent = useCallback((_noteId: string, date: number) => {
        // Which calls are sounding: the elements in force at this date, mapped back through the
        // fit's report. `callForElement` is the only thing that knows that mapping.
        const ids = new Set<string>();
        for (const instruction of getInstructions(mpm)) {
            if (instruction.id === undefined || instruction.date > date) continue;
            const owner = callForElement(instruction.id);
            if (owner) ids.add(owner);
        }
        if (ids.size > 0) setActiveCallIds(ids);
        scrollToDate(date);
    }, [setActiveCallIds, callForElement, mpm, scrollToDate]);

    const handlePlay = useCallback(() => {
        if (isPlaying) {
            stop();
        } else {
            play({ onNoteEvent: handleNoteEvent });
        }
    }, [isPlaying, play, stop, handleNoteEvent]);

    useHotkeys('space', () => handlePlay(), { preventDefault: true }, [handlePlay]);
    useHotkeys('meta+s', () => handleSave(), { preventDefault: true });
    useHotkeys('meta+o', () => onFileImport(), { preventDefault: true }, [onFileImport]);

    /**
     * Save: the archive the viewer reads.
     *
     *   transcription.mei   the score, with the recording aligned into it
     *   work.json           the chain, what each call wrote, and the segment it wrote it under
     *   performance.mpm     the MPM this run produced
     *   score.msm           the MEI converted, so the viewer need not convert
     *
     * The viewer reads the last three and derives the tree from them. It needs no `segments.json`:
     * every call records its own elements and range, so the projection is a few milliseconds of
     * arithmetic rather than a fourth file that can fall out of step with the first three.
     */
    const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));

    const handleSave = async () => {
        if (!mei) return;

        const newMEI = injectChoices(
            mei, msm, transformers
                .filter(call => call.name === 'MakeChoice')
                .map(call => call.options as unknown as MakeChoiceOptions)
        );

        const work: WorkFile = {
            name: metadata.title || 'Reconstruction',
            mei: 'transcription.mei',
            mpm: 'performance.mpm',
            provenance: transformers.map((call) => {
                const outcome = outcomeById.get(call.id);
                return outcome
                    ? {
                          ...call,
                          ...(outcome.elements.length > 0 && { elements: [...outcome.elements] }),
                          ...(outcome.range !== null && { range: outcome.range }),
                      }
                    : call;
            }),
            segments,
            ...(secondary !== undefined && { secondary: secondary as WorkFile['secondary'] }),
        };

        const zip = new JSZip();
        zip.file("transcription.mei", newMEI);
        zip.file("work.json", serializeWorkFile(work));
        zip.file("performance.mpm", exportMPM(mpm));
        zip.file("score.msm", scoreMsm);

        const content = await zip.generateAsync({ type: "blob" });
        downloadAsFile(content, 'export.zip', 'application/zip');
    };

    if (isEditorMode) {
        return (
            <>
                <Ribbon title='File'>
                    <Tooltip title='Open ZIP or MEI file' arrow>
                        <Button
                            onClick={onFileImport}
                            startIcon={<UploadFile />}
                        >
                            Open
                        </Button>
                    </Tooltip>

                    <Tooltip title='Save Work' arrow>
                        <span>
                            <IconButton
                                disabled={transformers.length === 0 || !mei}
                                onClick={handleSave}
                            >
                                <Save />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <input
                        type="file"
                        id="fileInput"
                        accept='application/xml,.mei,.zip'
                        style={{ display: 'none' }}
                        onChange={onFileChange}
                    />

                </Ribbon>

                {(getInstructions(mpm, ).length > 0) && (
                    <Ribbon title=' '>
                        <IconButton onClick={handlePlay}>
                            {isPlaying ? <Pause /> : <PlayArrow />}
                        </IconButton>
                    </Ribbon>
                )}

                <Ribbon title='Scope'>
                    <ToggleButtonGroup
                        size='small'
                        value={scope}
                        exclusive
                        onChange={(_, value) => setScope(value)}
                    >
                        <ToggleButton value='global'>
                            Global
                        </ToggleButton>
                        {Array.from(msm.parts()).map(p => (
                            <ToggleButton key={`button_${p}`} value={p}>
                                {p}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </Ribbon>
            </>
        );
    }

    // View mode
    return (
        <>
            {(getInstructions(mpm, ).length > 0) && (
                <Ribbon title="">
                    <IconButton onClick={handlePlay}>
                        {isPlaying ? <Pause /> : <PlayArrow />}
                    </IconButton>
                </Ribbon>
            )}

            <Tooltip title='Download ZIP' arrow>
                <span>
                    <IconButton
                        disabled={!mei}
                        onClick={handleSave}
                    >
                        <Save />
                    </IconButton>
                </span>
            </Tooltip>
        </>
    );
};
