import type { Element } from 'espressivo';
import { instructionTypes, mapOf, Mpm, scopesOf } from '../../instructions/index';
import { Alignment } from '../../alignment';
import { AbstractTransformer, type TransformationOptions } from '../Transformer';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RoundNumbersOptions extends TransformationOptions {}

/**
 * Digits kept after the decimal point. One figure for every attribute, dates included.
 *
 * Four rather than the two a `bpm` wants to read at, and the reason is measured. Rounding the
 * shipped reconstruction and rendering it against the same document unrounded:
 *
 *     places   largest onset shift   largest change in a gap between two onsets
 *          2             62.92 ms                                     11.75 ms
 *          3              7.55 ms                                      1.05 ms
 *          4              0.44 ms                                      0.17 ms
 *
 * Two places is not a uniform loss: four significant figures on a `@bpm` of 59 and two on a
 * `@meanTempoAt` of 0.57. `@meanTempoAt` shapes the elapsed time of a whole tempo segment, so its
 * error integrates along the piece rather than being spent on one note, and it alone accounts for
 * 60.3 ms of the 62.9. `@lateStart` fares worse: two places turn 0.00129 into nothing.
 *
 * At four places nothing audible survives, 0.44 ms against a JND of some tens of milliseconds,
 * and the document still reads in numbers a person can repeat.
 */
const DECIMALS = 4;

/** The modifiers MPM lets an `<articulation>` carry, and an `<articulationDef>` name. */
const ARTICULATION_MODIFIERS = [
  'absoluteDuration',
  'absoluteDurationChange',
  'absoluteDurationMs',
  'absoluteDurationChangeMs',
  'relativeDuration',
  'absoluteDelay',
  'absoluteDelayMs',
  'absoluteVelocity',
  'relativeVelocity',
  'absoluteVelocityChange',
  'detuneCents',
  'detuneHz',
] as const;

/**
 * The attributes that carry a measured quantity, by the element carrying them.
 *
 * An allow-list rather than "anything that parses as a number", and element-qualified rather
 * than by attribute name alone. MPM writes plenty of numbers that are not measurements — a
 * part's `@number`, `@midi.channel`, `@pulsesPerQuarter`, a MIDI `@controller` — and plenty of
 * strings that would parse as one, since `@name`, `@name.ref` and `@volume` all admit a name a
 * document is free to spell `1.005`. Rounding a reference is not a loss of precision, it is a
 * broken document.
 *
 * The vocabulary is what this application's transformers write, which is the whole of what can
 * reach here: `runFit` builds the document from `createMpm()` and never parses a foreign one.
 * An attribute missing from this table is left as it stands.
 */
const MEASURED: Readonly<Record<string, readonly string[] | undefined>> = {
  tempo: ['date', 'bpm', 'transition.to', 'beatLength', 'meanTempoAt'],
  dynamics: ['date', 'volume', 'transition.to', 'curvature', 'protraction'],
  movement: ['date', 'position', 'transition.to', 'curvature', 'protraction'],
  rubato: ['date', 'frameLength', 'intensity', 'lateStart', 'earlyEnd'],
  articulation: ['date', ...ARTICULATION_MODIFIERS],
  articulationDef: ARTICULATION_MODIFIERS,
  ornament: ['date', 'scale'],
  temporalSpread: ['frame.start', 'frameLength', 'intensity'],
  dynamicsGradient: ['transition.from', 'transition.to'],
  accentuationPattern: ['date', 'scale'],
  accentuationPatternDef: ['length'],
  accentuation: ['beat', 'value', 'transition.from', 'transition.to'],
  asynchrony: ['date', 'milliseconds.offset'],
  style: ['date'],
};

/** The whole subtree, root first. */
function* elementsUnder(element: Element): Generator<Element> {
  yield element;
  for (const child of element.getChildElements()) yield* elementsUnder(child);
}

/**
 * How `value` should read once rounded, or `null` where it is to be left as it stands.
 *
 * Left alone where it is not a number — `@volume` and `@bpm` may hold the name of a
 * `<dynamicsDef>` or a `<tempoDef>` — and where rounding does not change the text, so that an
 * already-round document comes out byte for byte the same.
 */
const roundedValue = (value: string): string | null => {
  // `Number('')` is 0, and an empty attribute is not a zero.
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  const rounded = String(Number(parsed.toFixed(DECIMALS)));
  return rounded === value ? null : rounded;
};

/**
 * Round every measured attribute in the document.
 *
 * A fitted MPM says `bpm="59.15049362182617"` where the recording knows a note's onset to a
 * millisecond. The long tail is the solver talking to itself, and MPM's premise is that a
 * performance is composed of simple statements, so the last thing a run does is write numbers a
 * reader could repeat.
 *
 * Measured over the shipped reconstruction by rendering before and after: the largest onset moves
 * by 0.44 ms, the largest note end by 0.44 ms, the largest velocity by 0.003 of a MIDI step, and
 * nothing reorders. {@link DECIMALS} says why four places and not two.
 *
 * Dates are rounded like everything else rather than snapped to whole ticks, which the same
 * measurement says would cost nothing (0.013 ms on top). An MPM date is real-valued by design:
 * 198 of this document's 200 `<movement>`s sit between ticks, because that is where the pedal
 * moved. Cutting digits states how precisely the document knows a number; moving a pedal onto the
 * grid states something about the performance.
 *
 * **No desk offers this.** `buildChain` puts one at the end of every chain, on the same footing
 * as `TranslatePhysicalTimeToTicks`: where it goes is not the user's to pick, it takes no options
 * and no scope, and a document is not made worse by having run it.
 *
 * It is answerable for nothing. Rounding changes the text of nearly every instruction, so the
 * diff in `AbstractTransformer.run` would credit this call with the whole document, where what it
 * did is restate what other calls decided. Hence {@link disowned}.
 */
export class RoundNumbers extends AbstractTransformer<RoundNumbersOptions> {
  name = 'RoundNumbers';
  requires = [];

  private restated: string[] = [];

  constructor() {
    super({});
  }

  protected transform(_msm: Alignment, mpm: Mpm): void {
    this.restated = [];
    const root = mpm.getRootElement();
    if (!root) return;

    for (const element of elementsUnder(root)) {
      if (!round(element)) continue;
      const id = element.getAttributeValue('id');
      if (id !== null) this.restated.push(id);
    }

    resortMaps(mpm);
  }

  protected override disowned(): readonly string[] {
    return this.restated;
  }
}

/** Round one attribute where the element has it. Answers whether its text changed. */
const roundAttribute = (element: Element, name: string): boolean => {
  const attribute = element.getAttribute(name);
  if (!attribute) return false;
  const rounded = roundedValue(attribute.getValue());
  if (rounded === null) return false;
  // Written through the attribute rather than through `addAttribute`, which removes and
  // re-appends and would therefore move the attribute to the end of the serialized element.
  attribute.setValue(rounded);
  return true;
};

/** Round what this element measures. Answers whether anything moved. */
const round = (element: Element): boolean => {
  const measured = MEASURED[element.getLocalName()] ?? [];
  // Mapped and then asked, rather than `some`: every attribute is to be rounded, and
  // short-circuiting on the first one that moves would leave the rest of the element alone.
  return measured.map((name) => roundAttribute(element, name)).includes(true);
};

/**
 * Put every map's date index back in step with the dates now written on its elements.
 *
 * A `GenericMap` caches each entry's `@date`, parsed once, and cannot see an edit made on the
 * element; `sort` re-reads them, and is what espressivo names as the remedy. It is a stable
 * insertion sort over a list rounding leaves in order, so nothing moves.
 */
const resortMaps = (mpm: Mpm): void => {
  for (const scope of scopesOf(mpm)) {
    for (const type of instructionTypes) mapOf(mpm, type, scope)?.sort();
  }
};
