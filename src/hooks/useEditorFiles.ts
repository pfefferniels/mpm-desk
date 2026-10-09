import { useCallback, useState } from 'react';
import JSZip from 'jszip';
import { convertMeiToMsm } from 'espressivo';
import { read, type MidiFile } from 'midifile-ts';
import { checkPerformance } from '../alignment/mlign';
import { asMSM } from '../fitting/asMSM';
import type { Alignment } from '../fitting/alignment';
import { parseMetadata } from '../mei/insertMetadata';
import { parseWorkFile, type WorkFile } from '../model/Work';
import type { Performance } from './Performances';

interface UseEditorFilesParams {
    /** Raise a message, or clear the one standing. */
    report: (message: string | undefined) => void;
    /** A work file was read; it is now the document, and the document as saved. */
    onLoadWork: (work: WorkFile) => void;
    /**
     * A different score was opened. `aligned` says whether a recording is aligned into it
     * already, which is whether any desk but the alignment desk has something to draw.
     */
    onNewScore: (aligned: boolean) => void;
}

interface EditorFiles {
    mei: string | undefined;
    /** The alignment as read out of the MEI, before the chain has touched it. */
    pristine: Alignment | null;
    performances: readonly Performance[];
    /** Take a rewritten MEI for the same score — what the alignment desk commits. */
    readMei: (content: string) => void;
    openFile: (file: File) => void;
    openMei: (file: File) => Promise<void>;
    openMidi: (file: File) => Promise<void>;
    openZip: (file: File) => Promise<void>;
}

/**
 * A take, under the `@source` its file names, else under the file's stem.
 *
 * A piano-roll scan names one itself.
 */
const performanceOf = (name: string, midi: MidiFile, bytes: Uint8Array): Performance => ({
    source: parseMetadata(midi).source ?? name.replace(/\.[^.]+$/, ''),
    name,
    midi,
    bytes,
});

/**
 * The three documents the editor opens: the MEI, the work file, and the recordings.
 *
 * The MEI and the takes are held here; the work file is handed on through `onLoadWork`, since the
 * document lives in `workReducer`.
 */
export const useEditorFiles = ({
    report,
    onLoadWork,
    onNewScore,
}: UseEditorFilesParams): EditorFiles => {
    const [pristine, setPristine] = useState<Alignment | null>(null);
    const [mei, setMEI] = useState<string>();
    const [performances, setPerformances] = useState<readonly Performance[]>([]);

    /**
     * The MEI, and the alignment read out of it.
     *
     * Called on open and again whenever the alignment desk commits — which is why it takes the
     * content rather than reading state, and why nothing here resets the scope: a rewritten
     * `<performance>` is the same score.
     */
    const readMei = useCallback(
        (content: string) => {
            setMEI(content);
            const converted = convertMeiToMsm(content)[0]?.msm;
            if (!converted) {
                report('The MEI holds no convertible movement.');
                return;
            }
            setPristine(asMSM(content, converted));
        },
        [report],
    );

    const loadMei = useCallback(
        (content: string) => {
            readMei(content);
            // A new score is not the one the takes in hand were played from.
            setPerformances([]);
            onNewScore(content.includes('<when'));
        },
        [readMei, onNewScore],
    );

    const loadWorkFromJson = useCallback(
        (content: string) => {
            try {
                onLoadWork(parseWorkFile(content));
                report(undefined);
            } catch (reason) {
                report(reason instanceof Error ? reason.message : String(reason));
            }
        },
        [onLoadWork, report],
    );

    const openMei = useCallback(
        async (file: File) => {
            loadMei(await file.text());
            document.title = `${file.name} - MPM Desk`;
        },
        [loadMei],
    );

    /**
     * A performance, read and kept as it arrived.
     *
     * The bytes as well as the parse: the aligner works on the parse, the archive stores the
     * bytes, and `midifile-ts` reads a file without writing one back.
     *
     * Minted here rather than in the desk because its `@source` must be unique against the takes
     * already in hand, which is what this holds.
     */
    const readPerformance = useCallback(
        async (file: File): Promise<Performance | undefined> => {
            const buffer = await file.arrayBuffer();
            const problem = checkPerformance(buffer);
            if (problem) {
                report(problem);
                return undefined;
            }

            let midi: MidiFile;
            try {
                midi = read(buffer);
            } catch {
                report(`${file.name} could not be read as MIDI.`);
                return undefined;
            }

            return performanceOf(file.name, midi, new Uint8Array(buffer));
        },
        [report],
    );

    const addPerformance = useCallback(
        (performance: Performance) => {
            setPerformances((current) => {
                // By file name, because that is what the archive stores it under: a second take
                // of the same name would replace the first in the zip and leave its `Align` call
                // naming a file that holds somebody else's playing.
                if (current.some((held) => held.name === performance.name)) {
                    report(`${performance.name} is already open.`);
                    return current;
                }
                return [...current, performance];
            });
        },
        [report],
    );

    const openMidi = useCallback(
        async (file: File) => {
            const performance = await readPerformance(file);
            if (performance) addPerformance(performance);
        },
        [readPerformance, addPerformance],
    );

    const openZip = useCallback(
        async (file: File) => {
            const zip = await JSZip.loadAsync(file);
            const meiFile = zip.file('transcription.mei');
            const jsonFile = zip.file('work.json');
            // Read before the MEI is: `loadMei` empties the takes, because opening a score is
            // opening a different piece, and an archive's takes are that score's own.
            const midiFiles = zip.file(/^recordings\//);

            if (meiFile) {
                loadMei(await meiFile.async('string'));
                document.title = `${file.name} - MPM Desk`;
            }
            if (jsonFile) loadWorkFromJson(await jsonFile.async('string'));

            for (const entry of midiFiles) {
                const bytes = await entry.async('uint8array');
                const name = entry.name.replace(/^recordings\//, '');
                const midi = read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
                addPerformance(performanceOf(name, midi, bytes));
            }
        },
        [loadMei, loadWorkFromJson, addPerformance],
    );

    const openFile = useCallback(
        (file: File) => {
            if (file.name.endsWith('.zip')) void openZip(file);
            else if (file.name.endsWith('.mei') || file.name.endsWith('.xml')) void openMei(file);
            else if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) void openMidi(file);
            // An unrecognised suffix must say so, or it is indistinguishable from a file that
            // failed to parse.
            else report(`Cannot open ${file.name} — expected a .zip, .mei, .xml or .mid.`);
        },
        [openZip, openMei, openMidi, report],
    );

    return { mei, pristine, performances, readMei, openFile, openMei, openMidi, openZip };
};
