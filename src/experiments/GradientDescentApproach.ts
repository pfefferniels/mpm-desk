type Point = {
    d: number, 
    y: number
}

const points: Point[] = [
    { d: 0,    y: 28.14 }, 
    { d: 720,  y: 29.07 }, 
    { d: 1440, y: 30.51 }, 
    { d: 2160, y: 32.42 }, 
    { d: 2880, y: 34.52 }, 
];


// Assume points is an array of objects with d and y properties
// const points = [{d: 100, y: 2}, {d: 200, y: 3}, {d: 300, y: 4}];
const d2 = points[points.length - 1].d; // Example value for d2, set this according to your needs

// Function to calculate f(d) for a given point
function f(d: number, t1: number, t2: number, p: number): number {
    return ((t2 - t1) * d ** (p + 1)) / (d2 ** p * (p + 1)) + t1 * d;
}

// -0,5 * x^2 / (10 * 2) + 1 * x


// -0,5 * x^2 + x

// t2 = 0.5
// t1 = 1
// p = 1

// Derivatives of the function with respect to t1, t2, and p
function dfdt1(d: number, p: number): number {
    return d - d ** (1 + p) / (d2 ** p * (1 + p));
}

function dfdt2(d: number, p: number): number {
    return d ** (1 + p) / (d2 ** p * (1 + p));
}

function dfdp(d: number, t1: number, t2: number, p: number): number {
    if (d === 0) return 0
    return -((d ** (1 + p) * (t1 - t2) * (-1 + (1 + p) * Math.log(d) - (1 + p) * Math.log(d2))) / (d2 ** p * (1 + p) ** 2));
}

// Cost function: Mean Squared Error
function computeCost(points: {d: number, y: number}[], t1: number, t2: number, p: number): number {
    let totalError = 0;
    for (let point of points) {
        totalError += (f(point.d, t1, t2, p) - point.y) ** 2;
    }
    return totalError / points.length;
}

// Gradient Descent Function
function gradientDescent(points: {d: number, y: number}[], t1: number, t2: number, p: number, learningRate: number, iterations: number): [number, number, number] {
    for (let i = 0; i < iterations; i++) {
        let t1Gradient = 0, t2Gradient = 0, pGradient = 0;
        
        for (let point of points) {
            t1Gradient += dfdt1(point.d, p) * (f(point.d, t1, t2, p) - point.y);
            t2Gradient += dfdt2(point.d, p) * (f(point.d, t1, t2, p) - point.y);
            pGradient += dfdp(point.d, t1, t2, p) * (f(point.d, t1, t2, p) - point.y);
        }

        if (i===0) console.log(t1Gradient, t2Gradient, pGradient)


        
        t1 -= learningRate * t1Gradient / points.length;
        t2 -= learningRate * t2Gradient / points.length;
        p -= learningRate * pGradient / points.length;
    }
    
    return [t1, t2, p];
}

// Example usage
let t1 = 0, t2 = 1, p = 1; // Initial guesses
const learningRate = 0.001;
const iterations = 1000;
const [finalT1, finalT2, finalP] = gradientDescent(points, t1, t2, p, learningRate, iterations);

console.log(`Final values - t1: ${finalT1}, t2: ${finalT2}, p: ${finalP}`);


 interface TempoWithEndDate {
    date: number;
    'bpm': number;
    'beatLength': number;
    'transition.to'?: number;
    'meanTempoAt'?: number;
    endDate: number,
}

const computeMillisecondsForConstantTempo = (date: number, tempo: TempoWithEndDate) => {
    console.log('computing constant')
    return ((15000.0 * (date - tempo.date)) / (tempo.bpm * tempo.beatLength * 720));
}

const computeMillisecondsForTransition = (date: number, tempo: TempoWithEndDate): number => {
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

console.log(f(10 / 720, 60, 120, 1) * (1000 / 60))

console.log(computeMillisecondsForTransition(10, {
    bpm: 60,
    "transition.to": 120,
    date: 0,
    endDate: 2880,
    meanTempoAt: 0.5,
    beatLength: 0.25
}))

