/**
 * End-to-end check for the MakeChoice/Modify bake, using the app's own modules.
 *
 * Runs the full transformer pipeline twice — once over the original MEI +
 * info.json (which still contain MakeChoice and Modify), once over the baked
 * ones — and compares the resulting MPM.
 *
 * Note that the MPM cannot be compared byte for byte: InsertDynamicsInstructions
 * and ApproximateLogarithmicTempo fit their curves by simulated annealing
 * (Math.random in mpmify's Approximation.ts), so fitted values differ between
 * any two runs, even on identical input. What must match is the *structure* —
 * the sequence of instruction elements and their dates. Exact equality of the
 * MSM the pipeline starts from is what scripts/verifyBake.ts proves.
 *
 * Needs the mpm-renderer backend on :8080.
 *
 * Usage:
 *   VITE_MPM_BACKEND_URL=http://localhost:8080 node_modules/.bin/vite-node \
 *     scripts/verifyPipeline.ts -- --original-mei <path> --original-info <path>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const argv = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const originalMeiPath = opt('original-mei', '')
const originalInfoPath = opt('original-info', '')
const bakedMeiPath = opt('mei', 'public/transcription.mei')
const bakedInfoPath = opt('info', 'public/info.json')

if (!originalMeiPath || !originalInfoPath) {
    console.error('need --original-mei and --original-info')
    process.exit(2)
}

// asMSM runs in the browser; give it the DOM globals it expects.
const { window } = new JSDOM()
globalThis.DOMParser = window.DOMParser

// In the app the Vite dev proxy injects the Origin the backend allowlists.
const ORIGIN = 'http://localhost:5173'
const nativeFetch = globalThis.fetch
globalThis.fetch = ((input, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', ORIGIN)
    return nativeFetch(input, { ...init, headers })
}) as typeof fetch

const { MPM, InsertMetadata, compareTransformers } = await import('mpmify')
const { exportMPM } = await import('mpm-ts')
const { asMSM } = await import('../src/utils/asMSM')
const { parseWork } = await import('../src/utils/workImport')

/** Mirrors the InsertMetadata transformer that pipeline.worker.ts prepends. */
const metadataTransformer = (metadata: { author: string; title: string }) => {
    const t = new InsertMetadata({
        authors: metadata.author ? [{ number: 0, text: metadata.author }] : [],
        comments: metadata.title ? [{ text: metadata.title }] : [],
    })
    t.argumentation = {
        note: '',
        id: 'argumentation-metadata',
        conclusion: { certainty: 'authentic', id: 'belief-metadata', motivation: 'calm' },
        type: 'simpleArgumentation',
    }
    return t
}

const runPipeline = async (meiPath: string, infoPath: string) => {
    const msm = await asMSM(readFileSync(meiPath, 'utf-8'))
    const parsed = parseWork(readFileSync(infoPath, 'utf-8'))
    if (parsed.validationMessages.length) {
        throw new Error(`${infoPath}: ${parsed.validationMessages.join('; ')}`)
    }

    const transformers = [metadataTransformer(parsed.metadata), ...parsed.transformers]
        .sort(compareTransformers)

    const mpm = new MPM()
    const log = console.log
    console.log = () => { }
    transformers.forEach(t => t.run(msm, mpm))
    console.log = log

    return { mpm: exportMPM(mpm), notes: msm.allNotes.length, transformers: transformers.length }
}

/**
 * The instruction skeleton: every element carrying a @date, as "tag@date".
 * Independent of the uuids and the annealed values that vary per run.
 */
const skeleton = (mpm: string) => {
    const doc = new DOMParser().parseFromString(mpm, 'application/xml')
    return Array.from(doc.querySelectorAll('[date]'))
        .map(el => `${el.tagName}@${el.getAttribute('date')}`)
}

const reference = await runPipeline(originalMeiPath, originalInfoPath)
const actual = await runPipeline(bakedMeiPath, bakedInfoPath)

console.log(`original: ${reference.transformers} transformers, ${reference.notes} notes`)
console.log(`baked:    ${actual.transformers} transformers, ${actual.notes} notes`)

const refSkeleton = skeleton(reference.mpm)
const actSkeleton = skeleton(actual.mpm)
console.log(`instructions: ${refSkeleton.length} original, ${actSkeleton.length} baked`)

if (refSkeleton.join('\n') === actSkeleton.join('\n')) {
    console.log('\nOK — identical instruction structure (values differ only by simulated annealing)')
    process.exit(0)
}

writeFileSync('/tmp/mpm-reference.mpm', reference.mpm)
writeFileSync('/tmp/mpm-actual.mpm', actual.mpm)
console.log('\nFAIL — instruction structure differs; wrote /tmp/mpm-reference.mpm and /tmp/mpm-actual.mpm')

let shown = 0
for (let i = 0; i < Math.max(refSkeleton.length, actSkeleton.length) && shown < 15; i++) {
    if (refSkeleton[i] !== actSkeleton[i]) {
        console.log(`  #${i}: expected ${refSkeleton[i]}, got ${actSkeleton[i]}`)
        shown++
    }
}
process.exit(1)
