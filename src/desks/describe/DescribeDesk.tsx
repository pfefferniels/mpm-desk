import { createDescriptionClient } from '../../fitting/description/client';
import { usePlayback } from '../../hooks/PlaybackProvider';
import { createSession } from './asking';
import { createExpert, EXPERT_MODEL, useExpertKey } from './expert';
import { leftIn } from './expert/left';
import { useDescribePlayback } from './playback';
import { useGivenServices, type DescribeServices } from './services';
import { DescribeSurface } from './Surface';
import { useRemarks } from './useRemarks';

/**
 * What the desk reaches outside the page with, as it is outside a test.
 *
 * One session for as long as the page is open, so that what is being asked of the expert
 * outlasts the desk being closed for another. Its worker is started by the first run.
 */
const REAL: DescribeServices = {
    session: createSession(createDescriptionClient),
    createExpert,
    expertModel: EXPERT_MODEL,
    leftIn,
    now: () => new Date().toISOString(),
    // Short, because the calls a remark becomes are named after it: `r-1a2b3c4d.0.0`.
    newId: () => `r-${crypto.randomUUID().slice(0, 8)}`,
};

/**
 * The describe desk: a recorded performance described in the reader's own words, on its roll.
 *
 * This is where the real expert, the real piano and the reader's key are put together with the
 * desk; what the desk is and does is `DescribeSurface` and `useRemarks`, which take all three as
 * given. It takes none of what every desk is handed: the fit's own alignment and MPM are of the
 * document as the chain ran it, and this desk runs the document itself, with what is assumed
 * where nothing is described and with an answer the document does not hold yet.
 */
export const DescribeDesk = () => {
    const services = useGivenServices() ?? REAL;
    const [expertKey, setExpertKey] = useExpertKey();
    const told = useRemarks(services, expertKey);
    // The app bar plays the document's MPM on the same piano. It is stopped before the roll
    // plays, so that it does not stop the piano under the roll when it believes its own run over.
    const { stop: silence } = usePlayback();
    const playback = useDescribePlayback({ run: told.run, places: told.places, client: services.session.client, silence });
    return <DescribeSurface told={told} playback={playback} expertKey={expertKey} onExpertKey={setExpertKey} services={services} />;
};
