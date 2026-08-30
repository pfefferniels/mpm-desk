import { readFileSync } from 'fs'
import { join } from 'path'
import { Resvg } from '@resvg/resvg-js'

export function loadFixture(name: string): string {
  return readFileSync(join(__dirname, name), 'utf-8')
}

export function renderToPng(svgString: string): Buffer {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: 1200 },
    background: 'white',
  })
  return Buffer.from(resvg.render().asPng())
}

export function pixelDiff(png1: Buffer, png2: Buffer): number {
  // Quick size check — if sizes differ drastically, return 100%
  if (Math.abs(png1.length - png2.length) / Math.max(png1.length, png2.length) > 0.5) {
    return 100
  }

  const len = Math.min(png1.length, png2.length)
  let diffCount = 0
  for (let i = 0; i < len; i++) {
    if (png1[i] !== png2[i]) diffCount++
  }
  // Also count excess bytes as diffs
  diffCount += Math.abs(png1.length - png2.length)

  return (diffCount / Math.max(png1.length, png2.length)) * 100
}
