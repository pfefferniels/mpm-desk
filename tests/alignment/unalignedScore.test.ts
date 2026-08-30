// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { convertMeiToMsm } from 'espressivo'
import { asMSM } from '../../src/fitting/asMSM'
import { runFit } from '../../src/fitting/fit'
import { deriveResidual } from '../../src/fitting/residual'
import { createMpm } from '../../src/fitting/instructions/index'
import { EMPTY_WORK } from '../../src/model/workReducer'
import '../../src/fitting/transformers/Order'

/**
 * A score nobody has aligned yet — which is where a project now starts.
 *
 * The editor opens on an MEI, converts it and reads the recording out of its `<performance>`. A
 * file that has none yields an alignment of no notes, and everything downstream of that has to
 * survive being asked about a recording that does not exist: the alignment desk is reachable only
 * *through* the editor, so a throw here is a score that cannot be aligned at all.
 *
 * The chopin fixture is a plain engraving — see `fixtures/README.md` — so it is exactly the file
 * somebody would open first.
 */

const unaligned = readFileSync(join(__dirname, 'fixtures', 'chopin-op38-mm18-22.mei'), 'utf-8')

const alignmentOf = (mei: string) => {
  const converted = convertMeiToMsm(mei)[0]?.msm
  expect(converted).toBeDefined()
  return asMSM(mei, converted!)
}

describe('a score with no recording in it', () => {
  it('converts, and reads as an alignment of nothing', () => {
    const alignment = alignmentOf(unaligned)

    expect(alignment.allNotes).toEqual([])
    expect(alignment.pedals).toEqual([])
    // Not -Infinity, which is what a fold over no notes would otherwise answer
    expect(alignment.lastDate()).toBe(0)
    expect(alignment.end).toBe(0)
  })

  it('has no score half to serialize, and says so rather than inventing one', () => {
    const alignment = alignmentOf(unaligned)

    expect(alignment.serialize()).toBeUndefined()
    expect(alignment.serializeScore()).toBeUndefined()
  })

  it('folds an empty chain over it without throwing', () => {
    const result = runFit(EMPTY_WORK, alignmentOf(unaligned))

    expect(result.unknown).toEqual([])
    expect(result.ground.notes).toEqual([])
    // The two injected calls ran, so there is a document to open a desk against
    expect(result.mpm).toContain('<mpm')
  })

  it('derives a residual that knows nothing, rather than failing to derive one', () => {
    const residual = deriveResidual(alignmentOf(unaligned), createMpm())

    expect(residual.notes).toEqual([])
    expect(residual.pedals).toEqual([])
  })
})
