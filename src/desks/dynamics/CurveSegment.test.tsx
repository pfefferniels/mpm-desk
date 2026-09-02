import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CurveSegment } from './CurveSegment'
import {
    computeInnerControlPointsXPositions,
    volumeAtDate,
} from '../../fitting/transformers/dynamics/Approximation'
import type { DynamicsWithEndDate } from '../../fitting/transformers/dynamics/InsertDynamicsInstructions'

/**
 * The desk has to draw the curve the renderer sounds.
 *
 * It used to default an absent `@curvature` to 0.5 — espressivo fills 0.0 (`resolveDynamics`) and
 * the fitter scores against 0.0 (`computeError`), so 70 of the 128 `<dynamics>` in the shipped
 * performance were drawn as an S-curve and played as a straight ramp. `||` did the same to the
 * three that state `curvature="0"` outright. See issue #15.
 */

const ramp: DynamicsWithEndDate = {
    id: 'd0',
    date: 0,
    endDate: 720,
    volume: 0,
    transitionTo: 127,
}

/** The volumes the drawn `d` attribute encodes, by date — the baseline corners dropped. */
const drawnVolumes = (instruction: DynamicsWithEndDate): Map<number, number> => {
    const { container } = render(
        <svg>
            <CurveSegment
                instruction={instruction}
                stretchX={1}
                stretchY={1}
                active={false}
                onClick={() => { }}
            />
        </svg>
    )

    const d = container.querySelector('path')?.getAttribute('d') ?? ''
    const volumes = new Map<number, number>()
    for (const [, x, y] of d.matchAll(/L (-?[\d.]+) (-?[\d.]+)/g)) {
        const date = Number(x)
        // Both baseline corners repeat a date already drawn at its real volume; 127 - y is the
        // volume back out of the y the component wrote.
        if (!volumes.has(date)) volumes.set(date, 127 - Number(y))
    }
    return volumes
}

/** What `volumeAtDate` — the renderer's own shape — answers for a given curvature. */
const soundedVolume = (instruction: DynamicsWithEndDate, curvature: number, date: number) =>
    volumeAtDate(
        { ...instruction, ...computeInnerControlPointsXPositions(curvature, 0.0) },
        date
    )

describe('CurveSegment', () => {
    // 180 and not the midpoint: a curvature-0.5 S-curve is symmetric, so it crosses the straight
    // ramp exactly at 360. A quarter of the way in, the two shapes are far apart.
    const probe = 180

    it('draws an absent @curvature as the straight ramp the renderer sounds', () => {
        const drawn = drawnVolumes(ramp)

        expect(drawn.get(probe)).toBeCloseTo(soundedVolume(ramp, 0.0, probe), 6)
        // The whole of the bug, stated as the thing that must no longer be true.
        expect(drawn.get(probe)).not.toBeCloseTo(soundedVolume(ramp, 0.5, probe), 1)
    })

    it('draws an explicit curvature="0" as no bend, not as an absent attribute', () => {
        const drawn = drawnVolumes({ ...ramp, curvature: 0 })

        expect(drawn.get(probe)).toBeCloseTo(soundedVolume(ramp, 0.0, probe), 6)
    })

    it('still honours a stated curvature', () => {
        const bent = { ...ramp, curvature: 0.5 }
        const drawn = drawnVolumes(bent)

        expect(drawn.get(probe)).toBeCloseTo(soundedVolume(bent, 0.5, probe), 6)
    })

    /** The desk samples per pixel rather than per tick; see issue #31. */
    it('samples what the segment covers on screen, not what it covers in ticks', () => {
        const long = { ...ramp, endDate: 46_000 }
        const corners = (stretchX: number) => {
            const { container } = render(
                <svg>
                    <CurveSegment
                        instruction={long}
                        stretchX={stretchX}
                        stretchY={1}
                        active={false}
                        onClick={() => { }}
                    />
                </svg>
            )
            return [...(container.querySelector('path')?.getAttribute('d') ?? '').matchAll(/L /g)].length
        }

        expect(corners(0.3)).toBe(Math.ceil(46_000 * 0.3) + 2)
        expect(corners(0.005)).toBe(Math.ceil(46_000 * 0.005) + 2)
    })
})
