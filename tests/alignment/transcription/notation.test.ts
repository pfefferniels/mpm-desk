import { describe, expect, it } from 'vitest'
import { actionFor, choiceLabel, notationOf } from '../../../src/alignment/readings'
import { signFor } from '../../../src/alignment/transcription/figure'
import { levelOf, levelPrior } from '../../../src/alignment/transcription/grid'
import { chooseStaff, chooseValue, fitsLayer, layOut, type LayerPiece } from '../../../src/alignment/transcription/place'
import { readScore } from '../../../src/alignment/transcription/scoreModel'
import { spell } from '../../../src/alignment/transcription/spell'
import { added, missing, parse, replaced, scoreMei, span } from './fixture'

const model = readScore(parse(scoreMei()))
const bar = model.measures[0]

describe('the score as the transcriber reads it', () => {
  it('counts each layer through from the barline', () => {
    expect(model.notes.get('n2')?.event.onset).toBe(1)
    expect(model.notes.get('n3')?.event.onset).toBe(2)
    expect(model.notes.get('b2')?.event.onset).toBe(2)
    expect(model.measures[1].onset).toBe(4)
  })

  it('times a note by what it sounds for where the page draws another value', () => {
    // A half-note head in a run of eighths, which Chopin writes for a note held through it
    const drawn = scoreMei(
      '<note xml:id="n1" pname="c" oct="5" dur="2" dur.ges="8" dots.ges="0"/><note xml:id="n2" pname="d" oct="5" dur="8"/><note xml:id="n3" pname="e" oct="5" dur="4"/><note xml:id="n4" pname="f" oct="5" dur="2"/>',
    )
    const read = readScore(parse(drawn))
    expect(read.notes.get('n2')?.event.onset).toBe(0.5)
    expect(read.notes.get('n4')?.event.onset).toBe(2)
  })

  it('reads a triplet as three in the time of two', () => {
    const triplets = scoreMei(
      '<tuplet num="3" numbase="2"><note xml:id="n1" pname="c" oct="5" dur="8"/><note xml:id="n2" pname="d" oct="5" dur="8"/><note xml:id="n3" pname="e" oct="5" dur="8"/></tuplet><note xml:id="n4" pname="f" oct="5" dur="2" dots="1"/>',
    )
    const read = readScore(parse(triplets))
    expect(read.notes.get('n2')?.event.onset).toBeCloseTo(1 / 3, 9)
    expect(read.notes.get('n4')?.event.onset).toBeCloseTo(1, 9)
    expect(read.measures[0].duration).toBeCloseTo(4, 9)
  })

  it('reads the performance reading where there is one, as verovio does', () => {
    const withReading = scoreMei(
      '<app><rdg source="original"><note xml:id="n1" pname="c" oct="5" dur="4"/></rdg><rdg source="performance"><note xml:id="other" pname="e" oct="5" dur="4"/></rdg></app><note xml:id="n2" pname="d" oct="5" dur="4"/><note xml:id="n3" pname="e" oct="5" dur="2"/>',
    )
    const read = readScore(parse(withReading))
    expect(read.notes.has('other')).toBe(true)
    expect(read.notes.has('n1')).toBe(false)
    expect(read.notes.get('n2')?.event.onset).toBe(1)
  })

  it('sounds a note as the key signature and the bar before it say', () => {
    const flats = scoreMei().replace('keysig="0"', 'keysig="2f"')
    const read = readScore(parse(flats))
    expect(read.notes.get('n6')?.pitch).toBe(75)
    expect(read.notes.get('n1')?.pitch).toBe(72)
  })
})

describe('the metrical grid', () => {
  const common = { count: 4, unit: 4 }
  const compound = { count: 6, unit: 8 }

  it('knows how deep in the beat a place lies', () => {
    expect(levelOf(2, common)).toBe(1)
    expect(levelOf(2.5, common)).toBe(2)
    expect(levelOf(2.25, common)).toBe(4)
    expect(levelOf(1 + 1 / 3, common)).toBe(3)
    expect(levelOf(0.2, common)).toBe(0)
  })

  it('takes three to the beat for the ordinary division of a compound metre', () => {
    expect(levelOf(1.5, compound)).toBe(1)
    expect(levelOf(0.5, compound)).toBe(3)
    expect(levelOf(0.25, compound)).toBe(6)
  })

  it('believes the bars around a note over what is usual', () => {
    const usual = levelPrior(new Map(), common)
    const inTriplets = levelPrior(new Map([[1, 8], [3, 16]]), common)

    expect(usual(2)).toBeGreaterThan(usual(3))
    expect(inTriplets(3)).toBeGreaterThan(inTriplets(2))
  })
})

describe('the staff, the length and the layer', () => {
  it('puts a note on the staff whose notes it lies among', () => {
    expect(chooseStaff(bar, 0, 36)?.n).toBe('2')
    expect(chooseStaff(bar, 1, 77)?.n).toBe('1')
    // Middle C is nearer the bass c3 than the treble c5 by nothing: it goes by what sounds
    expect(chooseStaff(bar, 2, 59)?.n).toBe('2')
  })

  it('writes the longest value that reaches no further than the next note', () => {
    expect(chooseValue(36, 12, bar)).toMatchObject({ dur: '8', dots: 0 })
    expect(chooseValue(0, 24, bar)).toMatchObject({ dur: '4', dots: 0 })
    expect(chooseValue(0, 36, bar)).toMatchObject({ dur: '4', dots: 1 })
    // Five sixteenths of room is a quarter, not a value that would run into the next note
    expect(chooseValue(0, 30, bar)).toMatchObject({ dur: '4', dots: 0 })
  })

  it('never writes past the barline, or out of the triplet it starts in', () => {
    expect(chooseValue(84, Infinity, bar).units).toBe(12)
    expect(chooseValue(32, Infinity, bar).units).toBeLessThanOrEqual(16)
  })

  /** How long a laid-out layer is, in grid units, and how many notes it holds. */
  const measure = (pieces: LayerPiece<string>[]): { units: number; items: number } =>
    pieces.reduce(
      (sum, piece) => {
        if (piece.kind === 'tuplet') {
          const inner = measure(piece.pieces)
          return { units: sum.units + inner.units, items: sum.items + inner.items }
        }
        return { units: sum.units + piece.value.units, items: sum.items + (piece.kind === 'item' ? 1 : 0) }
      },
      { units: 0, items: 0 },
    )

  it('pads a layer to exactly the length of its bar', () => {
    const plain = layOut([{ start: 36, value: chooseValue(36, 12, bar), payload: 'a' }], bar)
    expect(measure(plain)).toEqual({ units: 96, items: 1 })

    const empty = layOut<string>([], bar)
    expect(measure(empty)).toEqual({ units: 96, items: 0 })
  })

  it('closes a triplet over its quarter and writes plain time around it', () => {
    const pieces = layOut([{ start: 32, value: chooseValue(32, 8, bar), payload: 'a' }], bar)

    expect(measure(pieces)).toEqual({ units: 96, items: 1 })
    expect(pieces.map((piece) => piece.kind)).toEqual(['space', 'tuplet', 'space'])
    const bracket = pieces[1]
    expect(bracket.kind === 'tuplet' && measure(bracket.pieces).units).toBe(24)
  })

  it('will not put two things in one layer that sound at once, or a duplet inside a triplet', () => {
    const first = { start: 24, value: chooseValue(24, 24, bar), payload: 'a' }
    expect(fitsLayer([first], { start: 36, value: chooseValue(36, 12, bar), payload: 'b' }, bar)).toBe(false)
    expect(fitsLayer([first], { start: 48, value: chooseValue(48, 12, bar), payload: 'b' }, bar)).toBe(true)

    const triplet = { start: 32, value: chooseValue(32, 8, bar), payload: 'a' }
    // A thirty-second at the start of the same quarter has no place among triplet values
    expect(fitsLayer([triplet], { start: 27, value: chooseValue(27, 3, bar), payload: 'b' }, bar)).toBe(false)
  })
})

describe('what a pitch is called', () => {
  const staff = bar.staves[0]
  const nothing = { key: staff.key, around: [] }

  it('copies the spelling the bars around it use for that pitch', () => {
    const sharp = { ...model.notes.get('n2')!, pname: 'd', alter: 1, pitch: 75 }
    expect(spell(63, { key: staff.key, around: [sharp] })).toEqual({ pname: 'd', alter: 1, oct: 4 })
  })

  it('spells a note of the key as the key spells it', () => {
    const flats = new Map([['b', 'f'], ['e', 'f']])
    expect(spell(63, { key: flats, around: [] })).toEqual({ pname: 'e', alter: -1, oct: 4 })
    expect(spell(60, nothing)).toEqual({ pname: 'c', alter: 0, oct: 4 })
  })

  it('spells a chromatic note as the one nearest the music on the line of fifths', () => {
    // In C major with nothing sharper around, the note above f is f sharp, not g flat
    expect(spell(66, nothing)).toMatchObject({ pname: 'f', alter: 1 })
    // Among flats it is the flat
    const flats = new Map([['b', 'f'], ['e', 'f'], ['a', 'f'], ['d', 'f']])
    expect(spell(66, { key: flats, around: [] })).toMatchObject({ pname: 'g', alter: -1 })
  })

  it('writes the octave the spelling needs, which is not always the pitch\'s own', () => {
    expect(spell(59, { key: new Map([['c', 'f']]), around: [] })).toEqual({ pname: 'c', alter: -1, oct: 4 })
  })
})

describe('which ornament sign a figure would be', () => {
  it('calls both neighbours a turn, one neighbour repeated a trill, one neighbour once a mordent', () => {
    expect(signFor([76, 74, 72, 74], 74)).toEqual({ name: 'turn' })
    expect(signFor([76, 74, 76, 74, 76], 74)).toEqual({ name: 'trill' })
    expect(signFor([73], 74)).toEqual({ name: 'mordent', form: 'lower' })
    expect(signFor([76], 74)).toEqual({ name: 'mordent', form: 'upper' })
  })
})

describe('a reader\'s choice, and the action the work file keeps for it', () => {
  const octave = added('a', [span('x', 0, 36)])
  const gone = missing('m', ['n6'])
  const other = replaced('r', 'n5', span('y', 2000, 78), 77)

  it('reads no decision at all as leaving it to the transcriber', () => {
    expect(notationOf(undefined)).toBe('auto')
    expect(notationOf('mark-simplification')).toBe('auto')
    expect(notationOf('write-variant')).toBe('auto')
  })

  it('goes there and back for every correction a reader can make', () => {
    for (const notation of ['measured', 'grace', 'sign'] as const) {
      expect(notationOf(actionFor(octave, notation))).toBe(notation)
    }
    expect(notationOf(actionFor(other, 'as-written'))).toBe('as-written')
  })

  it('reads what an older file recorded as leaving the notation alone', () => {
    expect(notationOf('record')).toBe('none')
    expect(notationOf('ignore')).toBe('none')
  })

  it('names an answer by what it means for that kind of difference', () => {
    // A note that was not played is taken out, and nothing else is on offer
    expect(choiceLabel(gone, 'auto')).toBe('Taken out')
    expect(choiceLabel(octave, 'grace')).toBe('Grace')
    expect(choiceLabel(octave, 'measured')).toBe('Notes')
  })
})
