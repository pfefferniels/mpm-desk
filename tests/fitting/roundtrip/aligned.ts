import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertMeiToMsm, performMsmToData } from 'espressivo';
import type { PerformanceData, PerformedNote } from 'espressivo';
import { Alignment } from '../../../src/fitting/alignment';
import { createMpm, exportMPM } from '../../../src/fitting/instructions/index';
import { buildChain, isDocumentCall, isInjectedCall, validateChain } from '../../../src/fitting/chain';
import { parseWorkFile } from '../../../src/model/Work';
import { at } from '../../support/at';
import { deserializeAlignment, parseAlignmentFixture } from './alignmentFixture';
import { type AspectError, type Errors, EMPTY_MPM, statistics } from './harness';

/**
 * The round trip on a performance no MPM produced.
 *
 * Every case in `cases.ts` states its ground truth *as an MPM*, which is what makes the truth
 * exact — and also what bounds it: the chain is asked to recover something the renderer could
 * have written in the first place. A real recording is not in that image. Nothing guarantees a
 * Welte roll's onsets are a tempo curve plus a rubato frame, and what the chain cannot express
 * has nowhere to go but the error.
 *
 *     aligned MEI          --convertMeiToMsm--> score MSM
 *     alignment.*          --the fixture------> the recording, on the score
 *     that + chain.json    --the chain--------> MPM
 *     score MSM + MPM      --espressivo-------> a performance
 *                                               assert it is the recording again
 *
 * This is the check issue #51 asks for, and the chain is the real one — the calls a person
 * wrote for this passage, rebuilt by `buildChain` and run call by call. It is not a chain
 * assembled here to suit the measurement.
 *
 * It is also the one thing in this directory that says the drop of the six transformers did not
 * reach the reconstruction: `chain.json` is 84 calls over 14 transformers — 83 of them the run
 * takes from the file, the odd one being the `TranslatePhyiscalTimeToTicks` it now injects — and
 * every one of them is still registered. {@link runChain} throws if any is not.
 */

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', 'roundtrip', name), 'utf-8');

/** The frozen alignment — the fixtures' README says where it was cut from. */
const fromFixture = (): Alignment =>
  deserializeAlignment(
    parseAlignmentFixture(
      fixture('alignment.msm'),
      fixture('alignment.pedals.json'),
      fixture('alignment.sources.json'),
    ),
  );

export interface AlignedRun {
  /** The MEI as MSM — what the render performs. */
  scoreMsm: string;
  /** The chain's MPM. */
  mpmXml: string;
  /** The recording the chain was asked to reproduce, shifted to start at zero. */
  observed: Alignment;
  rendered: PerformanceData;
  errors: Errors;
  /**
   * How far the recording departs from the bare score under an empty MPM.
   *
   * A fixture that lost its `milliseconds.*` attributes — or a chain that resolved to nothing —
   * would leave the round trip comparing the score against itself and passing. This is what
   * says the fixture still carries a performance.
   */
  exercised: Errors;
  /** How much of the recording the chain's MPM actually accounts for, per aspect. */
  explained: { onset: number; duration: number; velocity: number };
  /**
   * How many of the chain file's own calls there are, and how many of them ran.
   *
   * Both counts leave out what the run does not take from the file: the calls `buildChain`
   * injects, and the ones it drops because it injects them. Counting the chain whole made these
   * two equal only while the run injected exactly as many calls as it dropped, so a third
   * injected call broke an assertion about the *file* by adding something the file never said.
   */
  calls: { declared: number; ran: number };
}

/**
 * Build a saved chain and run it, the way the desk does.
 *
 * This is what espressivo's `runChain` used to be, minus the module: `src/fitting/chain.ts`
 * builds and orders the chain and `src/model/Work.ts` reads the file, and running it is three
 * lines the caller owns. The one thing kept from the old runner is that a chain naming a
 * transformer this build does not have is an error rather than a quiet shortfall — `buildChain`
 * reports those instead of throwing, which is right for the desk and wrong for a measurement.
 */
const runChain = (alignment: Alignment, json: string) => {
  const { transformers, unknown } = buildChain(parseWorkFile(json).provenance);
  if (unknown.length)
    throw new Error(`chain names transformers this build has no: ${unknown.map((c) => c.name).join(', ')}`);

  const problems = validateChain(transformers);
  if (problems.length) throw new Error(problems.map((p) => p.message).join('\n'));

  const mpm = createMpm();
  for (const transformer of transformers) transformer.run(alignment, mpm);
  return { transformers, mpmXml: exportMPM(mpm) };
};

export const runAligned = (): AlignedRun => {
  const info = fixture('chain.json');

  const movements = convertMeiToMsm(fixture('traeumerei.mei'));
  if (!movements.length) throw new Error('MEI holds no convertible movement');
  const scoreMsm = at(movements, 0, 'movement').msm;

  // Its own alignment, not the one `recording` returns: the chain writes through what it is
  // given, and the recording has to survive the run unedited to be a target.
  const { mpmXml, transformers } = runChain(fromFixture(), info);

  const rendered = performMsmToData({ msm: scoreMsm, mpm: mpmXml });
  const bare = performMsmToData({ msm: scoreMsm, mpm: EMPTY_MPM });
  const observed = recording(info);

  const errors = compareToRecording(observed, rendered);
  const exercised = compareToRecording(observed, bare);

  return {
    scoreMsm,
    mpmXml,
    observed,
    rendered,
    errors,
    exercised,
    explained: {
      onset: explained(exercised.onset, errors.onset),
      duration: explained(exercised.duration, errors.duration),
      velocity: explained(exercised.velocity, errors.velocity),
    },
    calls: {
      declared: declaredCalls(info),
      ran: transformers.filter((t) => !isInjectedCall(t.name)).length,
    },
  };
};

/**
 * The recording as the chain was asked to reproduce it.
 *
 * Two of the chain's transformers are about the observation rather than about the MPM, and both
 * have to be applied before the recording is a target. `MakeChoice` picks one of the two
 * readings the fixture carries — without it every note is in it twice, once per source — and
 * `Modify` is the editor saying a note was played softer than the roll scan says. Reading the
 * fixture afresh rather than taking back the alignment the chain ran on is deliberate: a
 * transformer that quietly wrote its answer into the observations would otherwise be measured
 * against its own writing and score perfectly.
 */
const recording = (info: string): Alignment => {
  const observed = fromFixture();
  const { transformers } = buildChain(parseWorkFile(info).provenance);
  const scratch = createMpm();

  for (const transformer of transformers) {
    if (transformer.name === 'MakeChoice' || transformer.name === 'Modify') {
      transformer.run(observed, scratch);
    }
  }

  // The render starts the piece at zero; the roll starts it 28 seconds in.
  observed.shiftToFirstOnset();
  return observed;
};

/** The calls the file makes that the run takes from it — see {@link AlignedRun.calls}. */
const declaredCalls = (info: string): number => {
  const parsed = JSON.parse(info) as { provenance: { name: string }[] };
  return parsed.provenance.filter(
    (call) => !isInjectedCall(call.name) && !isDocumentCall(call.name),
  ).length;
};

/** The share of the recording's departure from the bare score that the MPM accounts for. */
const explained = (exercised: AspectError, remaining: AspectError) =>
  exercised.mean === 0 ? 0 : 1 - remaining.mean / exercised.mean;

/**
 * The recording against a render of it, note by note, matched on `xml:id`.
 *
 * The score MSM holds notes the recording does not: a note whose date and pitch a longer one
 * already claims was folded into that longer one, and a note the alignment never reached is not
 * in the fixture at all. Those are absent from the comparison rather than counted as error —
 * what they measure is the alignment, not the chain. A note the recording *does* have and the
 * render does not is `missing`, and that is a failure.
 */
const compareToRecording = (observed: Alignment, rendered: PerformanceData): Errors => {
  const byId = new Map<string, PerformedNote>();
  for (const part of rendered.parts) {
    for (const note of part.notes) if (note.id) byId.set(note.id, note);
  }

  const onsets: number[] = [];
  const durations: number[] = [];
  const velocities: number[] = [];
  let missing = 0;

  for (const note of observed.allNotes) {
    const performed = byId.get(note['xml:id']);
    if (!performed) {
      missing++;
      continue;
    }
    onsets.push(Math.abs(performed.milliseconds.date - note['milliseconds.date']));
    durations.push(
      Math.abs(
        performed.milliseconds.end -
          performed.milliseconds.date -
          (note['milliseconds.date.end'] - note['milliseconds.date']),
      ),
    );
    velocities.push(Math.abs(performed.velocity - note.velocity));
  }

  return {
    onset: statistics(onsets),
    duration: statistics(durations),
    velocity: statistics(velocities),
    matched: onsets.length,
    missing,
  };
};
