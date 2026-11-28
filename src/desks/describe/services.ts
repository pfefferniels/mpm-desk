import { createContext, useContext } from 'react';
import type { DescribeSession } from './asking';
import type { Expert } from './expert/types';
import type { DescribePlayback, PlaybackInput } from './playback/types';
import type { Left } from './match';
import type { RollNote } from '../../fitting/description/client';

/**
 * What the describe desk does not do itself, and is handed.
 *
 * Three things reach outside the page: the description worker, the expert, who is a model at the
 * other end of an API, and the piano. The desk is written against what each of them answers and
 * takes them from here, so that it can be mounted with all three scripted: in its tests, and in a
 * browser where there is no key to ask anyone with.
 *
 * `DescribeDesk` provides the real ones. A provider above it overrides them.
 */
export interface DescribeServices {
    /** The line of remarks being asked and the client they are tried on; see `asking.ts`. */
    session: DescribeSession;
    /** The expert a key speaks to. */
    createExpert: (apiKey: string) => Expert;
    /** The model that expert is, for saying whom a remark would be sent to. */
    expertModel: string;
    /** The reader's own key, kept in this browser. A hook. */
    useExpertKey: () => [string | null, (key: string | null) => void];
    /** Hearing the roll. A hook. */
    usePlayback: (input: PlaybackInput) => DescribePlayback;
    /** How far the rendering still is from the playing, over some notes or all of them. */
    leftIn: (notes: readonly RollNote[], ids?: readonly string[]) => Left;
    /** The moment a remark is made, ISO 8601, and the id it is given. */
    now: () => string;
    newId: () => string;
}

export const DescribeServicesContext = createContext<DescribeServices | null>(null);

/** The services a provider above the desk has put in place of the real ones, if any has. */
export const useGivenServices = (): DescribeServices | null => useContext(DescribeServicesContext);
