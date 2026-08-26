import { PPQ } from './score';

/**
 * The ground-truth MPM, as literal XML.
 *
 * Deliberately **not** built through the same writing path as the fit. If the truth were
 * serialized by the code under test, a bug in that serializer would corrupt both sides equally
 * and the round trip would pass on wrong output. The only code this path shares with the code
 * under test is espressivo's renderer — which is the point: the renderer is the arbiter of what
 * an MPM document *means*, and the fit is being measured against that meaning.
 */

export interface TempoSpan {
  date: number;
  bpm: number;
  'transition.to'?: number;
  meanTempoAt?: number;
  /** Fraction of a whole note. 0.25 is a quarter. */
  beatLength?: number;
}

export interface DynamicsSpan {
  date: number;
  volume: number;
  'transition.to'?: number;
  curvature?: number;
  protraction?: number;
}

export interface ArticulationDefSpec {
  name: string;
  relativeDuration?: number;
  relativeVelocity?: number;
  absoluteDuration?: number;
  absoluteDurationChange?: number;
}

export interface ArticulationTruth {
  defs: ArticulationDefSpec[];
  /**
   * Which def each note gets, cycled over the notes in score order. `['a', 'b']` alternates.
   * Omit to give every note the style's `defaultArticulation` instead.
   */
  pattern?: string[];
  /** Named on the `<style>` switch, so every note not named by an `<articulation>` gets it. */
  defaultArticulation?: string;
}

export interface RubatoFrame {
  date: number;
  frameLength: number;
  intensity: number;
  lateStart?: number;
  earlyEnd?: number;
  loop?: boolean;
}

export interface AccentuationTruth {
  date: number;
  name: string;
  /** Length of the pattern in beats. */
  length: number;
  scale: number;
  loop?: boolean;
  accentuations: { beat: number; value: number; 'transition.to'?: number }[];
}

export interface OrnamentDefSpec {
  name: string;
  /**
   * The roll. `frame.start` and `frameLength` are in `time.unit`, and the pool is spread
   * across the frame in `note.order`.
   */
  temporalSpread?: {
    'frame.start': number;
    frameLength: number;
    'time.unit'?: 'milliseconds' | 'ticks';
    'noteoff.shift'?: 'true' | 'false' | 'monophonic';
    intensity?: number;
  };
  /**
   * The velocity ramp across the roll, in normalized units. What reaches the performance is
   * `transition.* x @scale` on the instruction — see the note on `scale` below.
   */
  dynamicsGradient?: {
    'transition.from': number;
    'transition.to': number;
  };
}

export interface OrnamentationTruth {
  defs: OrnamentDefSpec[];
  instructions: {
    date: number;
    'name.ref': string;
    /**
     * Multiplies both ends of the `<dynamicsGradient>`, and **gates it entirely**: an
     * absent `@scale` reads as 0.0, so a def carrying a gradient performs nothing at all
     * while its temporal spread still applies in full. A gradient case that omits this
     * would render as a plain roll and round-trip perfectly while testing nothing.
     */
    scale?: number;
    'note.order'?: string;
  }[];
}

export interface Truth {
  tempo?: TempoSpan[];
  dynamics?: DynamicsSpan[];
  articulation?: ArticulationTruth;
  rubato?: RubatoFrame[];
  accentuation?: AccentuationTruth;
  ornamentation?: OrnamentationTruth;
}

const STYLE = 'truth_style';

const attrs = (record: Record<string, unknown>) =>
  Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('');

const element = (name: string, record: Record<string, unknown>, children = '') =>
  children ? `<${name}${attrs(record)}>${children}</${name}>` : `<${name}${attrs(record)}/>`;

/**
 * `<articulation>` instructions, one per note, cycling `pattern` over the notes in date order.
 *
 * The instruction carries the note's own date as well as its id: meico warns and the two
 * disagree, and a `date` of 0 on every instruction would make the map say something the case
 * does not mean.
 */
const articulationInstructions = (truth: ArticulationTruth, notes: ScoreNote[]) => {
  if (!truth.pattern?.length) return '';
  return notes
    .map((note, index) =>
      element('articulation', {
        date: note.date,
        'xml:id': `truth_art_${index}`,
        'name.ref': truth.pattern![index % truth.pattern!.length],
        noteid: `#${note.id}`,
      }),
    )
    .join('');
};

/** Just enough of a note for the articulation map: taken as an argument so this file need not
 * know about the `Alignment` class. */
export interface ScoreNote {
  id: string;
  date: number;
}

export const truthMpm = (truth: Truth, notes: ScoreNote[] = []): string => {
  const styles: string[] = [];
  const maps: string[] = [];

  if (truth.tempo?.length) {
    maps.push(
      element(
        'tempoMap',
        {},
        truth.tempo
          .map((span, index) =>
            element('tempo', {
              date: span.date,
              'xml:id': `truth_tempo_${index}`,
              bpm: span.bpm,
              beatLength: span.beatLength ?? 0.25,
              'transition.to': span['transition.to'],
              meanTempoAt: span.meanTempoAt,
            }),
          )
          .join(''),
      ),
    );
  }

  if (truth.rubato?.length) {
    maps.push(
      element(
        'rubatoMap',
        {},
        truth.rubato
          .map((frame, index) =>
            element('rubato', {
              date: frame.date,
              'xml:id': `truth_rubato_${index}`,
              frameLength: frame.frameLength,
              intensity: frame.intensity,
              lateStart: frame.lateStart,
              earlyEnd: frame.earlyEnd,
              loop: frame.loop,
            }),
          )
          .join(''),
      ),
    );
  }

  if (truth.dynamics?.length) {
    maps.push(
      element(
        'dynamicsMap',
        {},
        truth.dynamics
          .map((span, index) =>
            element('dynamics', {
              date: span.date,
              'xml:id': `truth_dyn_${index}`,
              volume: span.volume,
              'transition.to': span['transition.to'],
              curvature: span.curvature,
              protraction: span.protraction,
            }),
          )
          .join(''),
      ),
    );
  }

  if (truth.accentuation) {
    const pattern = truth.accentuation;
    styles.push(
      element(
        'metricalAccentuationStyles',
        {},
        element(
          'styleDef',
          { name: STYLE },
          element(
            'accentuationPatternDef',
            { name: pattern.name, length: pattern.length },
            pattern.accentuations
              .map((accentuation) =>
                element('accentuation', {
                  beat: accentuation.beat,
                  value: accentuation.value,
                  'transition.to': accentuation['transition.to'],
                }),
              )
              .join(''),
          ),
        ),
      ),
    );
    maps.push(
      element(
        'metricalAccentuationMap',
        {},
        element('style', { date: 0, 'name.ref': STYLE }) +
          element('accentuationPattern', {
            date: pattern.date,
            'xml:id': 'truth_accent_0',
            'name.ref': pattern.name,
            scale: pattern.scale,
            loop: pattern.loop ?? true,
          }),
      ),
    );
  }

  if (truth.ornamentation) {
    const ornamentation = truth.ornamentation;
    styles.push(
      element(
        'ornamentationStyles',
        {},
        element(
          'styleDef',
          { name: STYLE },
          ornamentation.defs
            .map((def) =>
              element(
                'ornamentDef',
                { name: def.name },
                (def.temporalSpread
                  ? element('temporalSpread', {
                      'frame.start': def.temporalSpread['frame.start'],
                      frameLength: def.temporalSpread.frameLength,
                      'time.unit': def.temporalSpread['time.unit'] ?? 'milliseconds',
                      'noteoff.shift': def.temporalSpread['noteoff.shift'] ?? 'false',
                      intensity: def.temporalSpread.intensity ?? 1,
                    })
                  : '') +
                  (def.dynamicsGradient
                    ? element('dynamicsGradient', { ...def.dynamicsGradient })
                    : ''),
              ),
            )
            .join(''),
        ),
      ),
    );
    maps.push(
      element(
        'ornamentationMap',
        {},
        element('style', { date: 0, 'name.ref': STYLE }) +
          ornamentation.instructions
            .map((instruction, index) =>
              element('ornament', {
                date: instruction.date,
                'xml:id': `truth_orn_${index}`,
                'name.ref': instruction['name.ref'],
                scale: instruction.scale,
                'note.order': instruction['note.order'] ?? 'ascending pitch',
              }),
            )
            .join(''),
      ),
    );
  }

  if (truth.articulation) {
    const articulation = truth.articulation;
    styles.push(
      element(
        'articulationStyles',
        {},
        element(
          'styleDef',
          { name: STYLE },
          articulation.defs.map((def) => element('articulationDef', { ...def })).join(''),
        ),
      ),
    );
    maps.push(
      element(
        'articulationMap',
        {},
        element('style', {
          date: 0,
          'name.ref': STYLE,
          defaultArticulation: articulation.defaultArticulation,
        }) + articulationInstructions(articulation, notes),
      ),
    );
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<mpm xmlns="http://www.cemfi.de/mpm/ns/1.0">' +
    `<performance name="truth" pulsesPerQuarter="${PPQ}">` +
    `<global><header>${styles.join('')}</header><dated>${maps.join('')}</dated></global>` +
    '</performance></mpm>'
  );
};
