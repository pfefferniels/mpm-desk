import type { DescriptionClient, DescriptionRun, Sounded } from '../../../fitting/description/client';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';

/** What is heard: the recording, or the MPM's rendering of the score. */
export type Hearing = 'played' | 'rendered';

export interface PlaybackInput {
    /** The document as it stands; null until its first run is in. */
    run: DescriptionRun | null;
    /** Where each remark of the run was made, by the id of its `Describe` call. */
    places: ReadonlyMap<string, DescribedPlace>;
    client: DescriptionClient;
    /**
     * Stops whatever else plays on the Desk's one piano, the app bar's transport above all. Called
     * before the desk plays, so that the other does not go on believing that it does and stop the
     * piano under the desk later.
     */
    silence?: () => void;
}

export interface DescribePlayback {
    readonly playing: boolean;
    /** Play was asked for while the samples were still coming, and starts by itself. */
    readonly pending: boolean;
    readonly hearing: Hearing;
    setHearing: (hearing: Hearing) => void;
    /** Starts at the line, or stops and leaves the line where it was. */
    toggle: () => void;
    stop: () => void;
    /** Puts the line at `ms` of the recording. Playing goes on from there. */
    seek: (ms: number) => void;
    /**
     * Plays a remark's passage, with what it takes around it to hear what the remark says, as the
     * MPM renders the plain score: what the remark wrote brought out, everything else held back.
     * Null stops and puts every note back.
     */
    bring: (remark: string | null) => void;
    /** The remark brought out now. */
    readonly brought: string | null;
    /** How strongly, from 1 (as written) to 1.9. */
    readonly strength: number;
    setStrength: (strength: number) => void;
    /**
     * While a remark is brought out: the notes of the stretch that is heard as that rendering has
     * them, on the recording's clock, for the roll to draw them there. Every other note stays
     * where the MPM has it. For a remark on the whole piece it is every note.
     */
    readonly moved: ReadonlyMap<string, Sounded> | null;
    /**
     * Where the line is, in ms of the recording. A store rather than a value, so that only what
     * draws the line follows it.
     */
    readonly line: { subscribe: (listener: () => void) => () => void; read: () => number };
}
