/**
 * One call per element, when the fit credits several.
 *
 * The outcomes below are the three shapes the shipped work file holds: a chain of dynamics
 * curves sharing their joints, a tempo curve redrawn over its own date, and a style pass that
 * touches every ornament the per-chord calls placed.
 */
import { describe, expect, it } from 'vitest';
import { useState, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { CallSelectionProvider, useCallSelection } from './CallSelection';
import type { CallOutcome } from '../model/Reconstruction';

const outcomes: CallOutcome[] = [
    { id: 'first curve', elements: ['dynamics_0', 'dynamics_1440'], range: { from: 0, to: 1440 } },
    { id: 'second curve', elements: ['dynamics_1440', 'dynamics_2880'], range: { from: 1440, to: 2880 } },
    { id: 'tempo as drawn', elements: ['tempo_0'], range: { from: 0, to: 2880 } },
    { id: 'tempo redrawn', elements: ['tempo_0'], range: { from: 0, to: 2880 } },
    { id: 'spread 720', elements: ['ornament_720'], range: { from: 720, to: null } },
    { id: 'spread 1440', elements: ['ornament_1440'], range: { from: 1440, to: null } },
    // Leads with the first ornament, as a pass does, and lists one no placed call reports.
    { id: 'style pass', elements: ['ornament_720', 'ornament_1440', 'ornament_2160'], range: null },
];

/** The provider as the editor mounts it, with the selection held as state. */
const providerWith = (initial: Set<string>) =>
    function Provider({ children }: { children: ReactNode }) {
        const [activeCallIds, setActiveCallIds] = useState(initial);
        return (
            <CallSelectionProvider
                calls={[]}
                outcomes={outcomes}
                activeCallIds={activeCallIds}
                setActiveCallIds={setActiveCallIds}
                onRemoveCalls={() => {}}
                focusCall={() => {}}
            >
                {children}
            </CallSelectionProvider>
        );
    };

const mount = (selected = new Set<string>()) =>
    renderHook(() => useCallSelection(), { wrapper: providerWith(selected) });

describe('which call an element answers to', () => {
    it('is the call that leads with it, not the first one credited', () => {
        const { result } = mount();
        // The joint of the chain: the first curve's closer, filled in by the second curve.
        expect(result.current.callForElement('dynamics_1440')).toBe('second curve');
        expect(result.current.callForElement('dynamics_0')).toBe('first curve');
    });

    it('is the later call where two lead with the same id', () => {
        const { result } = mount();
        expect(result.current.callForElement('tempo_0')).toBe('tempo redrawn');
    });

    it('is the call that placed it, not the pass that touched it', () => {
        const { result } = mount();
        expect(result.current.callForElement('ornament_720')).toBe('spread 720');
        expect(result.current.callForElement('ornament_1440')).toBe('spread 1440');
    });

    it('is the pass where nothing placed it', () => {
        const { result } = mount();
        expect(result.current.callForElement('ornament_2160')).toBe('style pass');
    });

    it('is nobody for an element no call reports', () => {
        const { result } = mount();
        expect(result.current.callForElement('dynamics_9999')).toBeUndefined();
    });
});

describe('what a selected call lights', () => {
    it('is only what answers to it, so a joint lights with one curve', () => {
        const { result } = mount(new Set(['first curve']));
        expect(result.current.activeElements).toEqual(['dynamics_0']);
    });

    it('includes a closer nothing was fitted onto', () => {
        const { result } = mount(new Set(['second curve']));
        expect(result.current.activeElements).toEqual(['dynamics_1440', 'dynamics_2880']);
    });

    it('selects the owning call from a click on the joint', () => {
        const { result } = mount();
        act(() => {
            result.current.setActiveElement('dynamics_1440');
        });
        expect(result.current.activeCallIds).toEqual(new Set(['second curve']));
        expect(result.current.activeElements).toEqual(['dynamics_1440', 'dynamics_2880']);
    });
});
