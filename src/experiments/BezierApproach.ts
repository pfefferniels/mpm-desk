import { points } from "../testdata";

export type Point = [number, number];

export interface TempoWithEndDate {
    date: number;
    'bpm': number;
    'beatLength': number;
    'transition.to'?: number;
    'meanTempoAt'?: number;
    endDate: number,
}

type BezierCurve = {
    P0: [number, number],
    P1: [number, number],
    P2: [number, number],
    x: (t: number) => number,
    y: (t: number) => number,
    derivative: BezierCurve
}

export const computeMillisecondsForConstantTempo = (date: number, tempo: TempoWithEndDate) => {
    console.log('computing constant')
    return ((15000.0 * (date - tempo.date)) / (tempo.bpm * tempo.beatLength * 720));
}

export const computeMillisecondsForTransition = (date: number, tempo: TempoWithEndDate): number => {
    if (!tempo["transition.to"]) {
        return computeMillisecondsForConstantTempo(date, tempo)
    }

    const N = 2 * Math.floor((date - tempo.date) / (720 / 4));
    const adjustedN = (N === 0) ? 2 : N;

    const n = adjustedN / 2;
    const x = (date - tempo.date) / adjustedN;

    const resultConst = (date - tempo.date) * 5000 / (adjustedN * tempo.beatLength * 720);
    let resultSum = 1 / tempo.bpm + 1 / getTempoAt(date, tempo);

    for (let k = 1; k < n; k++) {
        resultSum += 2 / getTempoAt(tempo.date + 2 * k * x, tempo);
    }

    for (let k = 1; k <= n; k++) {
        resultSum += 4 / getTempoAt(tempo.date + (2 * k - 1) * x, tempo);
    }

    return resultConst * resultSum;
}

const getTempoAt = (date: number, tempo: TempoWithEndDate): number => {
    // no tempo
    if (!tempo.bpm) return 100.0;

    // constant tempo
    if (!tempo["transition.to"]) return tempo.bpm

    if (date === tempo.endDate) return tempo["transition.to"]

    const result = (date - tempo.date) / (tempo.endDate - tempo.date);
    const exponent = Math.log(0.5) / Math.log(tempo.meanTempoAt || 0.5);
    return Math.pow(result, exponent) * (tempo["transition.to"] - tempo.bpm) + tempo.bpm;
}

const quadraticBezier = (P0: [number, number], P1: [number, number], P2: [number, number]): BezierCurve => {
    return {
        P0,
        P1,
        P2,
        x: (t: number) => Math.pow(1 - t, 2) * P0[0] + 2 * t * (1 - t) * P1[0] + Math.pow(t, 2) * P2[0],
        y: (t: number) => Math.pow(1 - t, 2) * P0[1] + 2 * t * (1 - t) * P1[1] + Math.pow(t, 2) * P2[1],
        derivative: {
            P0,
            P1,
            P2,
            x: (t: number) => 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]),
            y: (t: number) => 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1])
        }
    } as BezierCurve
}

interface CubicBezierCurve {
    P0: [number, number],
    P1: [number, number],
    P2: [number, number],
    P3: [number, number],
    x: (t: number) => number,
    y: (t: number) => number,
    derivative: {
        P0: [number, number],
        P1: [number, number],
        P2: [number, number],
        P3: [number, number],
        x: (t: number) => number,
        y: (t: number) => number
    }
}

const cubicBezier = (P0: [number, number], P1: [number, number], P2: [number, number], P3: [number, number]): CubicBezierCurve => {
    return {
        P0,
        P1,
        P2,
        P3,
        x: (t: number) => Math.pow(1 - t, 3) * P0[0] + 3 * t * Math.pow(1 - t, 2) * P1[0] + 3 * Math.pow(t, 2) * (1 - t) * P2[0] + Math.pow(t, 3) * P3[0],
        y: (t: number) => Math.pow(1 - t, 3) * P0[1] + 3 * t * Math.pow(1 - t, 2) * P1[1] + 3 * Math.pow(t, 2) * (1 - t) * P2[1] + Math.pow(t, 3) * P3[1],
        derivative: {
            P0,
            P1,
            P2,
            P3,
            x: (t: number) => 3 * Math.pow(1 - t, 2) * (P1[0] - P0[0]) + 6 * (1 - t) * t * (P2[0] - P1[0]) + 3 * Math.pow(t, 2) * (P3[0] - P2[0]),
            y: (t: number) => 3 * Math.pow(1 - t, 2) * (P1[1] - P0[1]) + 6 * (1 - t) * t * (P2[1] - P1[1]) + 3 * Math.pow(t, 2) * (P3[1] - P2[1])
        }
    } as CubicBezierCurve;
}

const rationalQuadraticBezier = (P0: [number, number], P1: [number, number], P2: [number, number], w0: number, w1: number, w2: number): BezierCurve => {
    const calc = (t: number, dim: 0 | 1) => {
        const numerator = w0 * Math.pow(1 - t, 2) * P0[dim] + w1 * 2 * t * (1 - t) * P1[dim] + w2 * Math.pow(t, 2) * P2[dim]
        const denominator = w0 * Math.pow(1 - t, 2) + w1 * 2 * t * (1 - t) + w2 * Math.pow(t, 2)

        return numerator / denominator
    }

    // P(t) = (weight * (1-t)^2 * P0 + 2 * t * (1 - t) * P1 + t^^2 * P2) / (weight * (1-t)^2 + 2 * t * (1-t) + t^2)
    // P'(t) = ?


    return {
        P0,
        P1,
        P2,
        x: (t: number) => calc(t, 0),
        y: (t: number) => calc(t, 1),
        derivative: {
            P0,
            P1,
            P2,
            x: (t: number) => 0, // TODO
            y: (t: number) => 0, // TODO
        }
    } as BezierCurve
}

/**
 * cf. https://www.researchgate.net/publication/220437355_A_new_method_for_video_data_compression_by_quadratic_Bezier_curve_fitting
 * https://cdn.hackaday.io/files/1946398327434976/Nouri-Suleiman-Least-Squares-Data-Fitting-with-Quadratic-Bezier-Curves.pdf
 */
const bestMiddle = (data: Point[], dimension: 0 | 1) => {
    let sum1 = 0;
    for (let i = 0; i < data.length; i++) {
        const ti = (1 / data.length) * i
        sum1 += data[i][dimension] - Math.pow(1 - ti, 2) * data[0][dimension] - Math.pow(ti, 2) * data[data.length - 1][dimension]
    }

    let sum2 = 0;
    for (let i = 0; i < data.length; i++) {
        const ti = (1 / data.length) * i
        sum2 += 2 * ti * (1 - ti)
    }

    return sum1 / sum2
}

export const findBezierCurve = (data: [number, number][]) => {
    if (data.length < 4) {
        throw new Error('At least 4 data points are required.')
    }

    const first = data[0]
    const last = data[data.length - 1]

    const tmpData = [
        data[0],
        data[1],
        // data[1], // favour the first data point
        ...data.slice(1)
    ]

    const P0: [number, number] = [first[0], first[1]]
    const P1: [number, number] = [bestMiddle(tmpData, 0), bestMiddle(tmpData, 1)]
    const P2: [number, number] = [last[0], last[1]]

    return quadraticBezier(P0, P1, P2);
}

const simulatedAnnealing = (points: Point[], initialTempo: TempoWithEndDate, initialTemperature: number = 500, coolingRate: number = 0.995, maxIterations: number = 1000): TempoWithEndDate => {
    let currentTempo = { ...initialTempo };
    console.log('trying to optimize', currentTempo)
    let bestTempo = { ...initialTempo };
    let bestError = computeTotalError(currentTempo, points);
    console.log('best error:', bestError)
    let temperature = initialTemperature;

    for (let iteration = 0; iteration < maxIterations && temperature > 0.001; iteration++) {
        const neighboringTempo = generateNeighboringTempo(currentTempo);
        const currentError = computeTotalError(currentTempo, points);
        const neighborError = computeTotalError(neighboringTempo, points);
        // console.log('trying', neighborError, 'for', neighboringTempo)

        if (Math.exp((currentError - neighborError) / temperature) > Math.random()) {
            currentTempo = { ...neighboringTempo };
        }

        if (neighborError < bestError) {
            bestError = neighborError;
            console.log('new best error=', neighborError, 'for', neighboringTempo)
            bestTempo = { ...neighboringTempo };
        }

        if (bestError < 10.0) {
            break;
        }

        temperature *= coolingRate;
    }

    return bestTempo;
};

const generateNeighboringTempo = (tempo: TempoWithEndDate): TempoWithEndDate => {
    // const randomVariation = (value: number, variation: number) => value + (Math.random() * 2 - 1) * variation;

    const variation = 0.2;
    const randomVariation = Math.random() * variation
    // 
    // let bpm = tempo.bpm
    // 
    // if (tempo.bpm > tempo["transition.to"]!) {
    //     bpm = Math.min(bpm, bpm + randomVariation)
    // }
    const isAcc = tempo.bpm < tempo["transition.to"]!
    const newBPM = tempo.bpm + (isAcc ? -randomVariation : randomVariation)
    const newTransitionTo = tempo["transition.to"]! + (isAcc ? randomVariation : -randomVariation)

    return {
        date: tempo.date,
        endDate: tempo.endDate,
        bpm: newBPM,
        'transition.to': newTransitionTo,
        meanTempoAt: tempo.meanTempoAt,
        beatLength: tempo.beatLength
    };
};

const computeTotalError = (tempo: TempoWithEndDate, points: Point[]) => {
    let totalError = 0;

    for (const point of points) {
        const error = computeMillisecondsForTransition(point[0], tempo) - point[1];
        // console.log('error=', error)
        if (isNaN(error)) {
            // console.log('nan!!!')
            continue
        }
        totalError += Math.pow(error, 2);
    }

    return totalError / points.length;
}

// es reicht, den letzten Punkt zu minimieren!
const computeEndError = (guessedInstruction: TempoWithEndDate, points: Point[]) => {
    return Math.abs(
        computeMillisecondsForTransition(guessedInstruction.endDate, guessedInstruction) - points[points.length - 1][1])
}

export const approximateFromData = (data: [number, number][]) => {
    console.log('approximating for', data[0][0], 'starting with', data[0][1])
    if (data.length <= 1) {
        throw new Error('At least 2 data points are required in order to approximate')
    }
    else if (data.length === 2) {
        return {
            'bpm': 60000 / (data[1][1] - data[0][1]),
            'date': data[0][0],
            endDate: data[1][0],
            'beatLength': (data[1][0] - data[0][0]) / 720 / 4
        }
    }
    else if (data.length === 3) {
        return {
            'bpm': 60000 / (data[1][1] - data[0][1]),
            date: data[0][0],
            endDate: data[data.length - 1][0],
            'transition.to': 60000 / (data[data.length - 1][1] - data[data.length - 2][1]),
            beatLength: (data[1][0] - data[0][0]) / 720 / 4
        }
    }

    const length = data[data.length - 1][0] - data[0][0]
    const curve = findBezierCurve(data)

    // const tempoCurve = (t: number) => (60000 * curve.derivative.x(t)) / (curve.derivative.y(t) * 720)

    let startBPM
    {
        // const x0 = -2 * curve.P0[0] + 2 * curve.P1[0]
        // const y0 = -2 * curve.P0[1] + 2 * curve.P1[1]
        // startBPM = (60000 * x0) / (y0 * 720)

        // const length = curve.x(1 / 10000) - curve.x(0)
        // const ms = curve.y(1 / 10000) - curve.y(0)
        // startBPM = (60000 * length) / (ms * 720)

        // startBPM = tempoCurve(0)
        startBPM = (curve.P1[0] - curve.P0[0]) / (curve.P1[1] - curve.P0[1]) * (60000 / 720)
    }

    let endBPM
    if (!endBPM) {
        // const x0 = -2 * curve.P1[0] + 2 * curve.P2[0]
        // const y0 = -2 * curve.P1[1] + 2 * curve.P2[1]
        // endBPM = (x0 / y0) * (60000 / 720)

        // const length = Math.abs(curve.x(1) - curve.x(1 - (1 / 1000)))
        // const ms = Math.abs(curve.y(1) - curve.y(1 - (1 / 1000)))
        // endBPM = (60000 * length) / (ms * 720)
        endBPM = (curve.P2[0] - curve.P1[0]) / (curve.P2[1] - curve.P1[1]) * (60000 / 720)
    }

    const meanTempo = (endBPM - startBPM) / 2 + startBPM
    const meanTempoAt = (125 * length + 3 * meanTempo * (curve.P0[1] - curve.P1[1])) / (3 * meanTempo * (curve.P0[1] - 2 * curve.P1[1] + curve.P2[1]))

    // Q1 = 2/3 * P1 + 1/3 * P0
    // Q2 = 2/3 * P1 + 1/3 * P2

    // f(x) = ((x-d_1)/(d_2-d_1))^(ln(0.5)/ln(i)) * (t_2 - t_1)+t_1
    const tmpTempo = {
        'bpm': 60000 / (data[1][1] - data[0][1]),
        date: data[0][0],
        endDate: data[data.length - 1][0],
        'transition.to': 60000 / (data[data.length - 1][1] - data[data.length - 2][1]),
        //bpm: startBPM,
        //'transition.to': endBPM,
        meanTempoAt: 0.5,
        // date: data[0][0],
        // endDate: data[data.length - 1][0],
        beatLength: 0.25
    }

    console.log('end error at', data[0][0], '=', computeEndError(tmpTempo, data))

    // return tmpTempo

    const newTempo = simulatedAnnealing(data, tmpTempo)

    // console.log(tmpTempo, 'vs', newTempo)
    return newTempo


    //console.log('---')
    //{
    //    const errors = []
    //    for (let i = 1; i < 500; i++) {
    //        const error = approximationError({
    //            bpm: startBPM,
    //            'transition.to': endBPM,
    //            meanTempoAt,
    //            date: data[0][0],
    //            endDate: data[data.length - 1][0],
    //            beatLength: 0.25
    //        }, data[data.length - 1][1] - data[0][1])
    //
    //        errors.push([i, error])
    //
    //        // TODO: try to minimize error by adjusting weight w1.
    //        // error / 2 is just a stupid guess ...
    //        const adjustedCurve = rationalQuadraticBezier(curve.P0, curve.P1, curve.P2, i, 1, 1)
    //        {
    //            const length = Math.abs(adjustedCurve.x(1) - adjustedCurve.x(1 - (1 / 1000)))
    //            const ms = Math.abs(adjustedCurve.y(1) - adjustedCurve.y(1 - (1 / 1000)))
    //            endBPM = (60000 * length) / (ms * 720)
    //        }
    //
    //        {
    //            const length = adjustedCurve.x(1 / 10000) - adjustedCurve.x(0)
    //            const ms = adjustedCurve.y(1 / 10000) - adjustedCurve.y(0)
    //            startBPM = (60000 * length) / (ms * 720)
    //        }
    //    }
    //    console.log('errors=', errors.map(e => `(${e.map(n => n.toFixed(2)).join(',')})`).join('\n'))
    //}

    // if (meanTempoAt < 0 || meanTempoAt > 1) {
    //     console.log('mean tempo must be within [0, 1], received', meanTempoAt, 'Normalizing to 0.5')
    //     meanTempoAt = 0.5
    // }
    // 
    // return {
    //     'bpm': startBPM,
    //     'transition.to': endBPM,
    //     meanTempoAt: meanTempoAt,
    //     date: data[0][0],
    //     endDate: data[data.length - 1][0],
    //     beatLength: 0.25
    // }
}

////////

export type Segment = {
    direction: 'rising' | 'falling',
    points: Point[],
    tempoPoints: Point[]
};

export const segmentCurve = (points: Point[]): Segment[] => {
    if (points.length < 3) {
        throw new Error('At least three points are required to form a curve.');
    }

    const diffPoints: Point[] = []
    for (let i = 0; i < points.length - 1; i++) {
        const yDiff = points[i + 1][1] - points[i][1]
        const xDiff = (points[i + 1][0] - points[i][0]) / 720

        diffPoints.push([points[i][0], yDiff / xDiff])
    }

    const segments: Segment[] = [];
    let currentSegment: Segment = {
        direction: diffPoints[1][1] > diffPoints[0][1] ? 'rising' : 'falling',
        points: [points[0]],
        tempoPoints: [diffPoints[0]]
    };

    // Function to add the current segment to segments and start a new one
    const startNewSegment = (point: Point, diffPoint: Point, direction: 'rising' | 'falling') => {
        // currentSegment.points.push(point)
        segments.push(currentSegment);

        currentSegment = {
            direction,
            points: [currentSegment.points[currentSegment.points.length - 1], point],
            tempoPoints: [currentSegment.tempoPoints[currentSegment.tempoPoints.length - 1], diffPoint]
        };
    };

    for (let i = 1; i < diffPoints.length; i++) {
        const [, previousTempo] = diffPoints[i - 1];
        const [, currentTempo] = diffPoints[i];

        if (currentTempo > previousTempo) { // The segment is rising
            if (currentSegment.direction === 'falling') {
                startNewSegment(points[i], diffPoints[i], 'rising');
            } else {
                currentSegment.points.push(points[i]);
                currentSegment.tempoPoints.push(diffPoints[i])
            }
        } else if (currentTempo < previousTempo) { // The segment is falling
            if (currentSegment.direction === 'rising') {
                startNewSegment(points[i], diffPoints[i], 'falling');
            } else {
                currentSegment.points.push(points[i]);
                currentSegment.tempoPoints.push(diffPoints[i])
            }
        } else {
            currentSegment.points.push(points[i]);
            currentSegment.tempoPoints.push(diffPoints[i])
        }
    }

    // Add the last segment to the list
    segments.push(currentSegment);

    return segments;
}

type WithSegment = {
    segment: Segment
}

export type TempoWithSegmentData = (TempoWithEndDate & WithSegment)

export const createTempoMapFromPoints = (points: Point[]) => {
    if (!points.length) {
        return []
    }

    const firstPoint = +`${points[0][1]}`
    points.forEach(point => point[1] = (point[1] - firstPoint) * 1000)

    const segments = segmentCurve(points);

    const instructions = segments.map(segment => {
        const segmentPoints = [...segment.points.map(p => [p[0], p[1]] as [number, number])]
        const firstPoint = +`${segmentPoints[0][1]}`
        segmentPoints.forEach(point => point[1] = (point[1] - firstPoint))
        console.log('segment points=', segmentPoints)

        const instruction = approximateFromData(segmentPoints)
        return {
            ...instruction,
            segment
        }
    })

    return instructions
}
