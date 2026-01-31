import React, { useCallback } from 'react';
import { Button, IconButton, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { PauseCircle, PlayCircle, Save, UploadFile } from '@mui/icons-material';
import { compareTransformers, exportWork, InsertMetadata, MakeChoice, MakeChoiceOptions, MPM, MSM } from 'mpmify';
import { Transformer } from 'mpmify/lib/transformers/Transformer';
import { exportMPM } from '../../../mpm-ts/lib';
import { Ribbon } from '../Ribbon';
import { ZoomControls } from '../ZoomControls';
import { ExportPNG } from '../ExportPng';
import { usePlayback } from '../hooks/PlaybackProvider';
import { useMode } from '../hooks/ModeProvider';
import { useSelection } from '../hooks/SelectionProvider';
import { downloadAsFile } from '../utils/utils';
import JSZip from 'jszip';

const injectChoices = (mei: string, msm: MSM, choices: MakeChoiceOptions[], removeRecordings = false): string => {
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
    msm: MSM;
    mpm: MPM;
    transformers: Transformer[];
    metadata: { author: string; title: string };
    secondary: Record<string, unknown>;
    scope: 'global' | number;
    setScope: (scope: 'global' | number) => void;
    stretchX: number;
    setStretchX: (stretchX: number) => void;
    selectedDesk: string;
    onFileImport: () => void;
    onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const AppMenu: React.FC<AppMenuProps> = ({
    mei,
    msm,
    mpm,
    transformers,
    metadata,
    secondary,
    scope,
    setScope,
    stretchX,
    setStretchX,
    selectedDesk,
    onFileImport,
    onFileChange,
}) => {
    const { isPlaying, play, stop } = usePlayback();
    const { isEditorMode } = useMode();
    const { setActiveTransformer } = useSelection();

    // Follow behavior: update active transformer based on playback position
    const handleNoteEvent = useCallback((_noteId: string, date: number) => {
        mpm
            .instructionsEffectiveAtDate(date)
            .filter(i => i.type === selectedDesk)
            .forEach(i => {
                setActiveTransformer(transformers.find(t => t.created.includes(i['xml:id'])));
            });
    }, [setActiveTransformer, mpm, selectedDesk, transformers]);

    const handlePlay = useCallback(() => {
        if (isPlaying) {
            stop();
        } else {
            play({ onNoteEvent: handleNoteEvent });
        }
    }, [isPlaying, play, stop, handleNoteEvent]);

    const handleSave = async () => {
        if (!mei) return;

        const newMEI = injectChoices(
            mei, msm, transformers
                .filter((t): t is MakeChoice => t.name === 'MakeChoice')
                .map(t => t.options)
        );

        const metadataTransformer = new InsertMetadata({
            authors: metadata.author ? [{ number: 0, text: metadata.author }] : [],
            comments: metadata.title ? [{ text: metadata.title }] : []
        });
        metadataTransformer.argumentation = {
            note: '',
            id: 'argumentation-metadata',
            conclusion: {
                certainty: 'authentic',
                id: 'belief-metadata',
                motivation: 'unknown'
            },
            type: 'simpleArgumentation'
        };

        const allTransformers = [metadataTransformer, ...transformers].sort(compareTransformers);

        const json = exportWork({
            name: metadata.title || 'Reconstruction',
            mpm: 'performance.mpm',
            mei: 'transcription.mei'
        }, allTransformers, secondary);

        const zip = new JSZip();
        zip.file("performance.mpm", exportMPM(mpm));
        zip.file("transcription.mei", newMEI);
        zip.file("info.json", json);

        const content = await zip.generateAsync({ type: "blob" });
        downloadAsFile(content, 'export.zip', 'application/zip');
    };

    if (isEditorMode) {
        return (
            <>
                <Ribbon title='File'>
                    <Tooltip title='Import MEI/JSON file' arrow>
                        <Button
                            onClick={onFileImport}
                            startIcon={<UploadFile />}
                        >
                            Open
                        </Button>
                    </Tooltip>

                    <Tooltip title='Save Work' arrow>
                        <IconButton
                            disabled={transformers.length === 0 || !mei}
                            onClick={handleSave}
                        >
                            <Save />
                        </IconButton>
                    </Tooltip>

                    <input
                        type="file"
                        id="fileInput"
                        accept='application/xml,.mei,application/json,.zip'
                        style={{ display: 'none' }}
                        onChange={onFileChange}
                    />

                    <ExportPNG transformers={transformers} msm={msm} />
                </Ribbon>

                {(mpm.getInstructions().length > 0) && (
                    <Ribbon title='Playback'>
                        <IconButton onClick={handlePlay}>
                            {isPlaying ? <PauseCircle /> : <PlayCircle />}
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

                <Ribbon title='Zoom'>
                    <ZoomControls
                        stretchX={stretchX}
                        setStretchX={setStretchX}
                        rangeX={[1, 60]}
                    />
                </Ribbon>
            </>
        );
    }

    // View mode
    return (
        <>
            {(mpm.getInstructions().length > 0) && (
                <Ribbon title='Playback'>
                    <IconButton onClick={handlePlay}>
                        {isPlaying ? <PauseCircle /> : <PlayCircle />}
                    </IconButton>
                </Ribbon>
            )}

            <Ribbon title='Zoom'>
                <ZoomControls
                    stretchX={stretchX}
                    setStretchX={setStretchX}
                    rangeX={[1, 60]}
                />
            </Ribbon>

            <Tooltip title='Download ZIP' arrow>
                <IconButton
                    disabled={!mei}
                    onClick={handleSave}
                >
                    <Save />
                </IconButton>
            </Tooltip>
        </>
    );
};
