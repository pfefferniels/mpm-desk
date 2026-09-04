import { useMemo } from 'react';
import { silentOrnaments, type Mpm, type Scope } from '../fitting/instructions/index';
import { ToolStatus } from '../components/toolbar/ToolStatus';

/**
 * How many ornaments here the renderer will pass over, in the bar of every desk that can put one
 * there.
 *
 * Fitting an arpeggio and stylizing it are two steps on two desks, and only the second makes a
 * sound. Both fitters leave their ornaments naming `neutralArpeggio` with the measured values
 * parked on the element, and `StylizeOrnamentation` turns those into `<ornamentDef>`s an ornament
 * can reach. Between the two the desk draws a fit that changes nothing, the markup shows an
 * `<ornament>` per chord, and the performance sounds as it did. This says so, in the amber the
 * bar uses for work still outstanding.
 *
 * The count is `silentOrnaments`, the renderer's own reckoning rather than "has Stylize been
 * clicked": an ornament the run skipped for an unusable frame keeps showing, which is the case
 * worth seeing and the one a flag on the call would hide.
 *
 * Always mounted, whatever the count, for `ToolStatus`'s reason.
 */
export const SilentOrnaments = ({ mpm, scope }: { mpm: Mpm; scope?: Scope }) => {
    // Memoised on the document, because the desks around it repaint on every frame of a zoom
    // drag and this walks each ornament's map to ask espressivo to resolve it.
    const silent = useMemo(() => silentOrnaments(mpm, scope).length, [mpm, scope]);

    return (
        <ToolStatus width={104} tone={silent ? 'warning' : 'default'}>
            {`${silent} unstylized`}
        </ToolStatus>
    );
};
