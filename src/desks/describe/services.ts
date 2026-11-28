import { createContext, useContext } from 'react';
import type { RollNote } from '../../fitting/description/client';
import type { DescribeSession } from './asking';
import type { Expert } from './expert';
import type { Left } from './match';

/**
 * What the describe desk does not do itself, and is handed.
 *
 * Two things reach outside the page before a note sounds: the description worker, and the
 * expert, who is a model at the other end of an API. The desk is written against what each of
 * them answers and takes them from here, so that it can be mounted with both scripted: in its
 * tests, and in a browser where there is no key to ask anyone with.
 *
 * `DescribeDesk` provides the real ones. A provider above it puts others in their place.
 *
 * The piano and the key are hooks, and a hook is not handed round: `DescribeDesk` calls the real
 * ones, a test calls its own, and `DescribeSurface` is given what they answered.
 */
export interface DescribeServices {
    /** The line of remarks being asked and the client they are tried on; see `asking.ts`. */
    session: DescribeSession;
    /** The expert a key speaks to. */
    createExpert: (apiKey: string) => Expert;
    /** The model that expert is, for saying whom a remark is sent to. */
    expertModel: string;
    /** How far the rendering still is from the playing, over some notes or all of them. */
    leftIn: (notes: readonly RollNote[], ids?: readonly string[]) => Left;
    /** The moment a remark is made, ISO 8601, and the id it is given. */
    now: () => string;
    newId: () => string;
}

export const DescribeServicesContext = createContext<DescribeServices | null>(null);

/** The services a provider above the desk has put in place of the real ones, if any has. */
export const useGivenServices = (): DescribeServices | null => useContext(DescribeServicesContext);
