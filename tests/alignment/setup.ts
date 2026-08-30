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
    // Verovio sets its measure numbers and tempo marks in `Times, serif`, which resolves to a
    // different face on every machine and then differs by more pixels than a layout change does.
    // Without system fonts the picture is the engraving alone, and that is what the baseline is
    // for. The faces under `public/fonts` cannot stand in: resvg reads no woff2.
    font: { loadSystemFonts: false },
  })
  return Buffer.from(resvg.render().asPng())
}

export interface Comparison {
  /** Share of the picture that differs, in percent */
  share: number
  /** The render, with the differing pixels in red — what to look at when the share surprises you */
  overlay: Buffer
}

/**
 * What separates two renderings of the same page, anti-aliasing aside.
 *
 * Decoding first is the point. Comparing the PNG files byte by byte answers a different question:
 * resvg ships a native binary per platform, so the same raster comes back under a different deflate
 * stream on Linux than on macOS, and one early differing byte makes every later byte differ too —
 * which read as a 99% difference for a picture that was in fact almost identical.
 */
export function comparePng(baselinePng: Buffer, renderedPng: Buffer): Comparison {
  const baseline = PNG.sync.read(baselinePng)
  const rendered = PNG.sync.read(renderedPng)

  if (baseline.width !== rendered.width || baseline.height !== rendered.height) {
    throw new Error(
      `rendered ${rendered.width}x${rendered.height}, baseline ${baseline.width}x${baseline.height}`,
    )
  }

  const overlay = new PNG({ width: baseline.width, height: baseline.height })
  const differing = pixelmatch(baseline.data, rendered.data, overlay.data, baseline.width, baseline.height)

  return {
    share: (differing / (baseline.width * baseline.height)) * 100,
    overlay: PNG.sync.write(overlay),
  }
}
