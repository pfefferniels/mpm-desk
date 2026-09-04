/**
 * The `ornamentDef` fields a fitter measures per instruction, before it knows which instructions
 * share a definition.
 *
 * **These are not `<ornament>` attributes.** Every one of them belongs on the def its
 * `@name.ref` points at — `transitionFrom`/`transitionTo` on a `<dynamicsGradient>`, the rest on
 * a `<temporalSpread>`. MPM has no place for them on the instruction, which is why espressivo's
 * `AddOrnamentOptions` has no field for them and why they cannot travel as part of one.
 *
 * They are parked *on the element*, as attributes, because the element is the only thing the two
 * transformers share: `InsertDynamicsGradient` writes the gradient half and
 * `InsertTemporalSpread` the spread half at the same date, and {@link fillInAt} makes the two one
 * `<ornament>`. A side table keyed by element would not survive the document being serialized
 * between them, nor whatever `TranslatePhyiscalTimeToTicks` does in between, which is to rewrite
 * two of these fields.
 *
 * `StylizeOrnamentation` ends their life, moving them into a real `<ornamentDef>` and calling
 * {@link clearOrnamentDraft}. A finished document carries none, so one surviving into a saved
 * file is a bug in the chain.
 *
 * Field names are espressivo's rather than the attributes': these values are on their way into
 * `OrnamentDef.setTemporalSpreadValues` and `setDynamicsGradientValues`, and matching those
 * spellings saves the hand-off a translation step.
 */
import { FrameDomain, NoteOffShift } from 'espressivo';
import { Attribute, Element } from 'espressivo';

export interface OrnamentDraft {
  /** `<dynamicsGradient>`'s `@transition.from`. */
  transitionFrom?: number;
  /** `<dynamicsGradient>`'s `@transition.to`. */
  transitionTo?: number;
  /** `<temporalSpread>`'s `@frame.start`. */
  frameStart?: number;
  /** `<temporalSpread>`'s `@frameLength`. */
  frameLength?: number;
  /** `<temporalSpread>`'s `@noteoff.shift`. */
  noteOffShift?: NoteOffShift;
  /** `<temporalSpread>`'s `@time.unit`, as the domain the frame figures are in. */
  frameDomain?: FrameDomain;
  /** `<temporalSpread>`'s `@intensity`. */
  intensity?: number;
}

/** Where each field is parked. The attribute names are the def's, which is where they end up. */
const ATTRIBUTES = {
  transitionFrom: 'transition.from',
  transitionTo: 'transition.to',
  frameStart: 'frame.start',
  frameLength: 'frameLength',
  noteOffShift: 'noteoff.shift',
  frameDomain: 'time.unit',
  intensity: 'intensity',
} as const satisfies Record<keyof OrnamentDraft, string>;

const NUMERIC = [
  'transitionFrom',
  'transitionTo',
  'frameStart',
  'frameLength',
  'intensity',
] as const;

const isNoteOffShift = (text: string): text is NoteOffShift =>
  text === NoteOffShift.True || text === NoteOffShift.False || text === NoteOffShift.Monophonic;

const isFrameDomain = (text: string): text is FrameDomain =>
  text === FrameDomain.Ticks || text === FrameDomain.Milliseconds;

/** What is parked on this `<ornament>`. Absent fields are fields nothing has fitted yet. */
export const ornamentDraftOf = (element: Element): OrnamentDraft => {
  const draft: OrnamentDraft = {};

  for (const key of NUMERIC) {
    const text = element.getAttributeValue(ATTRIBUTES[key]);
    if (text !== null) draft[key] = parseFloat(text);
  }

  const shift = element.getAttributeValue(ATTRIBUTES.noteOffShift);
  if (shift !== null && isNoteOffShift(shift)) draft.noteOffShift = shift;

  const domain = element.getAttributeValue(ATTRIBUTES.frameDomain);
  if (domain !== null && isFrameDomain(domain)) draft.frameDomain = domain;

  return draft;
};

/**
 * Park these fields on the element. A field the draft omits is left alone; one it carries as
 * `undefined` is removed — the same three cases espressivo's `patchAttribute` makes, so the two
 * halves of an `<ornament>` behave alike whichever one a caller is writing.
 */
export const setOrnamentDraft = (element: Element, draft: OrnamentDraft): void => {
  for (const [key, name] of Object.entries(ATTRIBUTES)) {
    if (!(key in draft)) continue;
    const value = draft[key as keyof OrnamentDraft];
    const existing = element.getAttribute(name);

    if (value === undefined) {
      if (existing) element.removeAttribute(existing);
      continue;
    }
    if (existing) existing.setValue(String(value));
    else element.addAttribute(new Attribute(name, String(value)));
  }
};

/** Take every parked field off, once a real `<ornamentDef>` holds them. */
export const clearOrnamentDraft = (element: Element): void => {
  for (const name of Object.values(ATTRIBUTES)) {
    const attribute = element.getAttribute(name);
    if (attribute) element.removeAttribute(attribute);
  }
};
