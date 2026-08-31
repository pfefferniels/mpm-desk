import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SilentOrnaments } from './SilentOrnaments';
import { createMpm, requireMap } from '../fitting/instructions/index';

/**
 * A document with `count` ornaments as the fitters leave them: `neutralArpeggio` is the
 * placeholder both write, and no definition ever carries that name. The parked draft is left off
 * — it is what `StylizeOrnamentation` reads, and nothing about resolving a `@name.ref`.
 */
const withOrnaments = (count: number) => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'ornament', 'global');
    Array.from({ length: count }, (_, index) =>
        map.addOrnamentV3({ date: index * 720, nameRef: 'neutralArpeggio' }),
    );
    return mpm;
};

describe('SilentOrnaments', () => {
    it('counts the ornaments that reach no definition', () => {
        render(<SilentOrnaments mpm={withOrnaments(2)} />);

        expect(screen.getByText('2 unstylized')).toBeInTheDocument();
    });

    /**
     * The readout is the bar's only word on a fit that changes nothing, so it holds its place
     * whatever the count — see `ToolStatus`. A conditional one would jump the row it sits in at
     * the moment the last ornament gains a definition.
     */
    it('stays on the bar when there is nothing outstanding', () => {
        render(<SilentOrnaments mpm={createMpm()} />);

        expect(screen.getByText('0 unstylized')).toBeInTheDocument();
    });
});
