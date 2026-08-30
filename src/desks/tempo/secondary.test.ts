import { describe, expect, it } from 'vitest';
import { scopeData, withScopeData, type TempoSecondaryData } from './secondary';
import type { TempoSegment } from './Tempo';

const box = (start: number, end: number): TempoSegment => ({
    date: { start, end },
    selected: false,
    silent: false,
});

/** The shape every work file written before the desk was scope-aware carries. */
const undivided: TempoSecondaryData = {
    tempoCluster: [box(0, 720)],
    silentOnsets: [{ date: 720, onset: 1.5 }],
};

describe('scopeData', () => {
    it('reads an undivided bag as the global scope', () => {
        expect(scopeData(undivided, 'global')).toEqual(undivided);
    });

    it('gives a part nothing out of an undivided bag', () => {
        expect(scopeData(undivided, 0)).toEqual({});
    });

    it('keeps the scopes apart', () => {
        const data = withScopeData(withScopeData(undefined, 0, { tempoCluster: [box(0, 720)] }), 1, {
            tempoCluster: [box(0, 1440)],
        });

        expect(scopeData(data, 0).tempoCluster).toEqual([box(0, 720)]);
        expect(scopeData(data, 1).tempoCluster).toEqual([box(0, 1440)]);
        expect(scopeData(data, 'global')).toEqual({});
    });
});

describe('withScopeData', () => {
    it('divides an undivided bag on the first write, keeping what it held', () => {
        const written = withScopeData(undivided, 1, { tempoCluster: [box(0, 1440)] });

        expect(written.tempoCluster).toBeUndefined();
        expect(scopeData(written, 'global')).toEqual(undivided);
        expect(scopeData(written, 1).tempoCluster).toEqual([box(0, 1440)]);
    });

    it('leaves the scope’s other fields alone', () => {
        const written = withScopeData(undivided, 'global', { drawnLines: [] });

        expect(scopeData(written, 'global')).toEqual({ ...undivided, drawnLines: [] });
    });
});
