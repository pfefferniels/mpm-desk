import React, { useEffect, useRef, useState } from 'react'
import '../App.css'
import { createTempoMapFromPoints } from './BezierApproach'
import { TimeSegment } from '../layers/TimeSegment'
import { TempoSegment } from '../layers/TempoSegment'
import { Segment } from '../layers/Segment'

type FlexPoint = {
  x: number
  y: number
  active: boolean
}

const toPoint = (p: FlexPoint): [number, number] => {
  return [p.x, p.y]
}

const testData = `0, 1.816077098
720, 3.476734694
1440, 4.672743764
2160, 6.458390023
2880, 7.724603175
3600, 9.057687075
4320, 10.44938776
5040, 12.31038549
5760, 13.48755102
6480, 14.57546485
7200, 16.19612245
7920, 17.80081633
8640, 20.4484127
9360, 22.78417234
10080, 24.84102041
10800, 26.73965986
11520, 28.14260771
12240, 29.72714286
12960, 31.3129932
13680, 32.92145125
14400, 35.3222449`


function TempoExperiment() {
  const [data, setData] = useState(testData)
  const svgRef = useRef<SVGSVGElement>(null)
  const [points, setPoints] = useState<FlexPoint[]>([])

  useEffect(() => {
    if (!svgRef) return

    const newPoints: FlexPoint[] = data.split('\n').map(line => {
      const vals = line.split(',')
      if (vals.length !== 2) return { x: 0, y: 0, active: false }
      return {x: +vals[0].trim(), y: +vals[1].trim(), active: true }
    })

    const firstX = +`${newPoints[0].x}`
    newPoints.forEach(p => {
      p.x -= firstX
    })

    setPoints(newPoints)
  }, [data])

  const instructions = createTempoMapFromPoints(points.map(p => toPoint(p)))
  const height = 500

  return (
    <>
      Enter some test data:<br />
      <textarea onChange={(e) => setData(e.target.value)} value={data} />
      <br />
      <p>
        {instructions.length} segments detected<br />
      </p>

      <svg width={1000} height={height} ref={svgRef} style={{ marginLeft: '2rem' }}>
        {instructions.map((instruction, i) => {
          return (
            <React.Fragment key={`segment-${i}`}>
              <Segment
                segment={instruction}
                toSVG={p => {
                  return [
                    0.07 * p[0] + 20,
                    height - 0.01 * p[1] - 50
                  ]
                }} />

              <TimeSegment
                instruction={instruction}
                toSVG={p => {
                  return [
                    0.07 * p[0] + 20,
                    height - 0.01 * p[1] - 50
                  ]
                }}
                deactivate={(p) => {
                  const newPoints = points.slice()
                  const index = newPoints.findIndex(point => point.x === p[0])
                  newPoints.splice(index, 1)
                  setPoints(newPoints)
                }} />

              <TempoSegment
                instruction={instruction}
                toSVG={p => {
                  return [
                    0.07 * p[0] + 20,
                    height - 25 * p[1]
                  ]
                }} />
            </React.Fragment>
          )
        })}
      </svg>
    </>
  )
}

export default TempoExperiment
