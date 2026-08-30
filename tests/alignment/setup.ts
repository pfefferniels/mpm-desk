import { readFileSync } from 'fs'
import { join } from 'path'
import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

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

/**
 * The share of pixels that differ, anti-aliasing aside.
 *
 * Decoding first is the point. Comparing the PNG files byte by byte answers a different question:
 * resvg ships a native binary per platform, so the same raster comes back under a different deflate
 * stream on Linux than on macOS, and one early differing byte makes every later byte differ too —
 * which read as a 99% difference for a picture that was in fact identical.
 */
export function pixelDiff(png1: Buffer, png2: Buffer): number {
  const baseline = PNG.sync.read(png1)
  const rendered = PNG.sync.read(png2)

  if (baseline.width !== rendered.width || baseline.height !== rendered.height) {
    throw new Error(
      `rendered ${rendered.width}x${rendered.height}, baseline ${baseline.width}x${baseline.height}`,
    )
  }

  const differing = pixelmatch(baseline.data, rendered.data, undefined, baseline.width, baseline.height)
  return (differing / (baseline.width * baseline.height)) * 100
}
