/**
 * The bake itself: MEI + info.json ⇒ score MSM, performance MPM, intensity segments.
 *
 * Shared by `bakeSegments.ts`, which writes the result to `public/`, and
 * `verifySegments.ts`, which re-derives it and diffs against what was written.
 *
 * Everything here is bake-time only. It is the last place mpmify runs.
 */
import {
    compareTransformers,
    getRange,
    importWork,
    InsertMetadata,
    MPM,
    registerTransformer,
    validate,
} from 'mpmify'
import type { MSM, Transformer } from 'mpmify'
import { convertMeiToMsmMpm } from 'espressivo'
import { exportMPM } from 'mpm-ts'
import { InsertTempo } from './InsertTempo'
import { asMSM } from './asMSM'
import { mergeOverlappingArgumentations } from './mergeArgumentations'
import type { Reconstruction, Segment, Span } from '../src/model/Reconstruction'

registerTransformer(InsertTempo, { after: 'ApproximateLogarithmicTempo' })

export interface Derived {
    /** The MEI as MSM — what a render performs. */
    scoreMsm: string
    /** The pipeline's MPM, serialized. */
    mpmXml: string
    reconstruction: Reconstruction
    /** The run itself, for `verifySegments.ts` to compare the segments against. */
    pipeline: {
        transformers: Transformer[]
        msm: MSM
        mpm: MPM
    }
    stats: {
        transformers: number
        argumentations: number
        /** Spans dropped because every element they made was removed again. */
        droppedSpans: number
        /** Element ids dropped because a later transformer removed the instruction. */
        droppedElements: number
    }
}

const quiet = <T>(fn: () => T): T => {
    const log = console.log
    console.log = () => { }
    try { return fn() } finally { console.log = log }
}

export const derive = (mei: string, info: string): Derived => {
    const movements = convertMeiToMsmMpm(mei)
    if (!movements.length) throw new Error('MEI holds no convertible movement')
    const scoreMsm = movements[0].msm

    const msm = asMSM(mei, scoreMsm)

    const { transformers: loaded } = importWork(info)
    const messages = validate(loaded)
    if (messages.length) throw new Error(messages.map(m => m.message).join('\n'))

    const metadata = loaded.find(t => t.name === 'InsertMetadata') as InsertMetadata | undefined
    const title = metadata?.options.comments?.[0]?.text ?? ''
    const author = metadata?.options.authors?.[0]?.text ?? ''

    // The app dropped the imported InsertMetadata and prepended its own, built
    // from the title and author it had extracted. Same document, one code path.
    const metadataTransformer = new InsertMetadata({
        authors: author ? [{ number: 0, text: author }] : [],
        comments: title ? [{ text: title }] : [],
    })
    metadataTransformer.argumentation = {
        note: '',
        id: 'argumentation-metadata',
        conclusion: { certainty: 'authentic', id: 'belief-metadata', motivation: 'calm' },
        type: 'simpleArgumentation',
    }

    const ran: Transformer[] = [
        metadataTransformer,
        ...loaded.filter(t => t.name !== 'InsertMetadata'),
    ].sort(compareTransformers)

    const mpm = new MPM()
    quiet(() => ran.forEach(transformer => transformer.run(msm, mpm)))

    // The viewer ran this on every pipeline result, so it is part of what the
    // segments are: argumentations covering the exact same ticks are one.
    const transformers = mergeOverlappingArgumentations(ran, msm)

    const instructions = mpm.getInstructions() as { 'xml:id': string; type: string }[]
    const typeById = new Map(instructions.map(i => [i['xml:id'], i.type]))

    const segments: Segment[] = []
    let droppedSpans = 0
    let droppedElements = 0

    for (const [argumentation, group] of Map.groupBy(transformers, t => t.argumentation)) {
        const range = getRange(group, msm)
        if (!range) continue
        const from = range.from
        const to = range.to ?? range.from

        const byId = new Map<string, Span>()
        for (const transformer of group) {
            // A transformer's `created` outlives the instructions: a later one
            // may have removed or merged them away again.
            const elements = transformer.created.filter(id => typeById.has(id))
            droppedElements += transformer.created.length - elements.length
            if (elements.length === 0) { droppedSpans++; continue }

            // Transformers that act on the whole piece (InsertDynamicsGradient)
            // resolve to no range of their own and take the segment's.
            const spanRange = getRange(transformer.options, msm)
            const span: Span = {
                id: elements[0],
                type: typeById.get(elements[0])!,
                from: spanRange?.from ?? from,
                to: spanRange?.to ?? to,
                elements,
            }

            // info.json holds a handful of transformers repeated verbatim; the
            // second overwrote the first's instruction and reported the same
            // deterministic id, so the viewer drew two identical lanes. One
            // element, one span.
            const existing = byId.get(span.id)
            if (!existing) { byId.set(span.id, span); continue }
            existing.from = Math.min(existing.from, span.from)
            existing.to = Math.max(existing.to, span.to)
            for (const id of elements) if (!existing.elements.includes(id)) existing.elements.push(id)
        }
        const spans = [...byId.values()]
        if (spans.length === 0) continue

        segments.push({
            id: argumentation.id,
            motivation: argumentation.conclusion.motivation,
            certainty: argumentation.conclusion.certainty,
            ...(argumentation.conclusion.note ? { note: argumentation.conclusion.note } : {}),
            ...(argumentation.continue ? { continue: argumentation.continue } : {}),
            from,
            to,
            spans,
        })
    }

    return {
        scoreMsm,
        mpmXml: exportMPM(mpm),
        reconstruction: { title, author, segments },
        pipeline: { transformers, msm, mpm },
        stats: {
            transformers: ran.length,
            argumentations: new Set(ran.map(t => t.argumentation?.id)).size,
            droppedSpans,
            droppedElements,
        },
    }
}
