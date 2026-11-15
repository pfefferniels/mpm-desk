import type {
  AddedDivergence,
  MissingDivergence,
  ReplacedDivergence,
} from '../../../src/alignment/divergences'
import {
  insertDeletionWhen,
  insertInsertionWhen,
  insertRecording,
  insertSubstitutionWhen,
  insertWhen,
} from '../../../src/mei/when'
import type { NoteSpan } from '../../../src/performance/midiSpans'

/**
 * Two bars of C major in common time, a quarter note every half second.
 *
 *   bar 1   right hand   c5  d5  <e5 g5>(half)        left hand   c3(half)  g3(half)
 *   bar 2   right hand   f5  e5  d5(half)             left hand   c3(whole)
 *
 * Small enough to read, and it has one of everything a performer can do something to: a single
 * note, a chord, a long note with nothing moving against it, and two staves to choose between.
 */
export const SOURCE = 'take'

const note = (id: string, pname: string, oct: number, dur: string) =>
  `<note xml:id="${id}" pname="${pname}" oct="${oct}" dur="${dur}"/>`

export const scoreMei = (bar1Right?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead><fileDesc><titleStmt><title/></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4" keysig="0"><staffGrp>
      <staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>
      <staffDef n="2" lines="5" clef.shape="F" clef.line="4"/>
    </staffGrp></scoreDef>
    <section>
      <measure xml:id="m1" n="1">
        <staff n="1"><layer n="1">${
          bar1Right ??
          `${note('n1', 'c', 5, '4')}${note('n2', 'd', 5, '4')}<chord xml:id="ch" dur="2"><note xml:id="n3" pname="e" oct="5"/><note xml:id="n4" pname="g" oct="5"/></chord>`
        }</layer></staff>
        <staff n="2"><layer n="1">${note('b1', 'c', 3, '2')}${note('b2', 'g', 3, '2')}</layer></staff>
      </measure>
      <measure xml:id="m2" n="2">
        <staff n="1"><layer n="1">${note('n5', 'f', 5, '4')}${note('n6', 'e', 5, '4')}${note('n7', 'd', 5, '2')}</layer></staff>
        <staff n="2"><layer n="1">${note('b3', 'c', 3, '1')}</layer></staff>
      </measure>
    </section>
  </score></mdiv></body></music>
</mei>`

/** When each written note of the default score was played, at a quarter note to the half second. */
export const PLAYED: Record<string, { ms: number; pitch: number }> = {
  n1: { ms: 0, pitch: 72 },
  n2: { ms: 500, pitch: 74 },
  n3: { ms: 1000, pitch: 76 },
  n4: { ms: 1000, pitch: 79 },
  b1: { ms: 0, pitch: 48 },
  b2: { ms: 1000, pitch: 55 },
  n5: { ms: 2000, pitch: 77 },
  n6: { ms: 2500, pitch: 76 },
  n7: { ms: 3000, pitch: 74 },
  b3: { ms: 2000, pitch: 48 },
}

export const span = (id: string, onsetMs: number, pitch: number, lengthMs = 240): NoteSpan => ({
  type: 'note',
  id,
  onset: onsetMs,
  offset: onsetMs + lengthMs,
  onsetMs,
  offsetMs: onsetMs + lengthMs,
  pitch,
  velocity: 60,
  channel: 0,
})

export const added = (
  id: string,
  spans: NoteSpan[],
  reading: AddedDivergence['reading'] = 'added-note',
  anchorId: string | null = null,
): AddedDivergence => ({
  kind: 'added',
  id,
  perfIds: spans.map((entry) => entry.id),
  pitches: spans.map((entry) => entry.pitch),
  anchorId,
  anchorFrom: anchorId ? 'timing' : null,
  signs: [],
  reading,
  because: '',
  onsetMs: spans[0].onsetMs,
  confidence: 1,
})

export const missing = (
  id: string,
  scoreIds: string[],
  reading: MissingDivergence['reading'] = 'omitted-note',
): MissingDivergence => ({ kind: 'missing', id, scoreIds, reading, because: '', onset: 0, confidence: 1 })

export const replaced = (id: string, scoreId: string, played: NoteSpan, written: number): ReplacedDivergence => ({
  kind: 'replaced',
  id,
  scoreId,
  perfId: played.id,
  pitches: [written, played.pitch],
  reading: 'different-note',
  because: '',
  onset: 0,
  onsetMs: played.onsetMs,
  lateMs: 0,
  confidence: 1,
})

/**
 * The score with a recording in it, as `applyAlignment` would have written one.
 *
 * Every written note is matched where `PLAYED` says, except the ones named as unplayed or as
 * played at another pitch; every extra span is an insertion. Each key is down for `heldMs`,
 * most of a quarter note unless said otherwise.
 */
export const aligned = (
  mei: string,
  options: {
    extra?: NoteSpan[]
    unplayed?: string[]
    substituted?: Record<string, NoteSpan>
    played?: Record<string, { ms: number; pitch: number }>
    heldMs?: number
  } = {},
): string => {
  const doc = new DOMParser().parseFromString(mei, 'application/xml')
  const recording = insertRecording(doc, SOURCE)!
  const played = options.played ?? PLAYED

  for (const [id, { ms, pitch }] of Object.entries(played)) {
    if (!doc.querySelector(`[*|id="${id}"]`)) continue
    if (options.unplayed?.includes(id)) insertDeletionWhen(doc, recording, id)
    else if (options.substituted?.[id]) {
      insertSubstitutionWhen(doc, recording, id, options.substituted[id], { writtenPitch: pitch })
    } else insertWhen(doc, recording, span(`perf-${id}`, ms, pitch, options.heldMs ?? 450), id)
  }
  for (const extra of options.extra ?? []) insertInsertionWhen(doc, recording, extra)

  return new XMLSerializer().serializeToString(doc)
}

/** A document as text that does not depend on the order its attributes were set in. */
export const canonical = (mei: string): string => {
  const doc = new DOMParser().parseFromString(mei, 'application/xml')
  const walk = (element: Element): string => {
    const attributes = [...element.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(' ')
    const children = [...element.childNodes]
      .map((child) => (child.nodeType === 1 ? walk(child as Element) : (child.textContent ?? '').trim()))
      .join('')
    return `<${element.localName} ${attributes}>${children}</${element.localName}>`
  }
  return walk(doc.documentElement)
}

export const parse = (mei: string): Document => new DOMParser().parseFromString(mei, 'application/xml')
