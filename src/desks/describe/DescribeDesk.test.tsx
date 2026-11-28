import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { DeskToolbarProvider } from '../../components/DeskToolbar';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import type { DescriptionClient, DescriptionRun, Sounded, Step } from '../../fitting/description/client';
import { CallSelectionProvider } from '../../hooks/CallSelection';
import { EditingContext } from '../../hooks/Editing';
import { PlaybackProvider } from '../../hooks/PlaybackProvider';
import { ScoreDocumentProvider } from '../../hooks/ScoreDocument';
import { ScrollSyncProvider } from '../../hooks/ScrollSyncProvider';
import { WorkDocumentProvider } from '../../hooks/WorkDocument';
import { ZoomContext } from '../../hooks/ZoomProvider';
import type { Call, WorkFile } from '../../model/Work';
import { initialHistory, workHistoryReducer, type WorkHistory } from '../../model/workReducer';
import { createFakePiano } from '../../test/fakePiano';
import { theme } from '../../theme';
import { createSession } from './asking';
import { DescribeDesk } from './DescribeDesk';
import { leftIn } from './expert/left';
import type { Expert, ExpertAnswer, ExpertFailure, ExpertRequest } from './expert';
import type { DescribePlayback, Hearing, PlaybackInput } from './playback';
import { DescribeServicesContext, type DescribeServices } from './services';
import { DescribeSurface } from './Surface';
import { useRemarks } from './useRemarks';

/**
 * The describe desk, mounted, with everything that reaches outside the page scripted: the
 * description worker, the expert and the piano.
 *
 * The document is the real one: the editor's own reducer with its history under the real
 * `WorkDocumentProvider`, so that "one edit" here is one step of undo as the editor counts them.
 */

/**
 * The Desk's one piano, for the desk as it is registered: a rig that keeps what it was handed to
 * play. Every other test here hands the desk a scripted playback and never comes by it.
 */
const rig = createFakePiano();
vi.mock('../../performance/piano', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../performance/piano')>()),
    usePiano: () => rig.usePiano(),
    whenSamplesArrive: () => null,
}));

/** An identity screen matrix, which jsdom has none of and every gesture on the roll goes through. */
beforeAll(() => {
    const identity = { a: 1, inverse: () => identity };
    const proto = SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown; createSVGPoint: () => unknown };
    proto.getScreenCTM = () => identity;
    proto.createSVGPoint = () => {
        const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) };
        return point;
    };
});

// ---------------------------------------------------------------------------------------------
// The piece: four notes a beat apart over a held bass note, a second to the beat
// ---------------------------------------------------------------------------------------------

const note = (id: string, date: number, pitch: number, pitchname: string, over: Partial<AlignedNote> = {}): AlignedNote => ({
    'xml:id': id,
    part: 1,
    staff: '1',
    layer: '1',
    date,
    duration: 720,
    pitchname,
    accidentals: 0,
    octave: 4,
    'milliseconds.date': 1000 + (date / 720) * 1000,
    'milliseconds.date.end': 1900 + (date / 720) * 1000,
    'midi.pitch': pitch,
    velocity: 64,
    ...over,
});

const piece = () =>
    new Alignment(
        [
            note('a', 0, 72, 'c'),
            note('b', 720, 76, 'e'),
            note('c', 1440, 79, 'g'),
            note('d', 2160, 84, 'c'),
            note('low', 0, 48, 'c', { part: 2, staff: '2', duration: 2880, 'milliseconds.date.end': 4900 }),
        ],
        [{ date: 0, numerator: 4, denominator: 4 }],
    );

// ---------------------------------------------------------------------------------------------
// The description worker, scripted
// ---------------------------------------------------------------------------------------------

/**
 * A description client that resolves a document the way the real one reports it, without a chain.
 *
 * A step is one call named after its remark, its place among the steps and `0`, as the real ids
 * are. `Broken` does not run and says why; `Withheld` runs and is kept out; a remark with steps
 * that ran is rendered where it was played, and one without is rendered a tenth of a second late.
 */
const scriptedClient = (arrived: Readonly<Record<string, Sounded>> = {}) => {
    const runOf = (alignment: { allNotes: AlignedNote[] }, calls: readonly Call[], trial?: { remark: string; steps: Step[] }): DescriptionRun => {
        const remarks = calls
            .filter((call) => call.name === 'Describe')
            .map((call) => ({ id: call.id, steps: (call.options['steps'] ?? []) as Step[] }));
        if (trial) {
            const tried = remarks.find((remark) => remark.id === trial.remark);
            if (tried) tried.steps = trial.steps;
            else remarks.push({ id: trial.remark, steps: trial.steps });
        }
        const reports = remarks.map(({ id, steps }) => {
            const told = steps.map((step, index) => {
                const call = { id: `${id}.${String(index)}.0`, name: step.name === 'FitTempo' ? 'InsertTempo' : step.name, options: step.options };
                const report = { calls: [] as string[], elements: [] as string[], written: [] as string[], definitions: [], evidence: ['b', 'c'], fitted: [], range: null };
                if (step.name === 'Broken') return { report: { ...report, evidence: [], error: 'there is nothing there to fit' }, concrete: [] };
                if (step.name === 'Withheld') return { report: { ...report, withheld: 'InsertRubato needs an InsertTempo before it, and this run only assumed one' }, concrete: [] };
                return { report: { ...report, calls: [call.id], elements: [`tempo_${call.id}`], written: ['<tempo date="0" bpm="60">'] }, concrete: [call] };
            });
            return { id, concrete: told.flatMap((each) => each.concrete), steps: told.map((each) => each.report) };
        });
        const explained = reports.some((report) => report.concrete.length > 0);
        const late = explained ? 0 : 100;
        return {
            mpm: '<mpm/>',
            score: '<msm/>',
            roll: {
                notes: alignment.allNotes.map((played) => {
                    const sounded = { ms: played['milliseconds.date'], msEnd: played['milliseconds.date.end'], velocity: played.velocity };
                    return {
                        id: played['xml:id'],
                        part: played.part,
                        pitch: played['midi.pitch'],
                        date: played.date,
                        duration: played.duration,
                        ...sounded,
                        ...(arrived[played['xml:id']] && { arrived: arrived[played['xml:id']] }),
                        mpm: { ms: sounded.ms + late, msEnd: sounded.msEnd + late, velocity: sounded.velocity },
                        late: -late,
                        longMs: 0,
                        loud: 0,
                    };
                }),
                graces: [],
                pedals: { played: [], mpm: [] },
                beats: [0, 720, 1440, 2160, 2880].map((date) => ({ date, ms: 1000 + (date / 720) * 1000 })),
                assumed: { tempo: explained ? [] : [{ from: 0, to: 2880, bpm: 60 }], level: 64, levelDates: [0] },
                level: 64,
                end: 2880,
                timeSignatures: [{ date: 0, numerator: 4, denominator: 4 }],
            },
            remarks: reports,
            problems: [],
        };
    };
    const describe = vi.fn<DescriptionClient['describe']>(async (alignment, calls, options) => runOf(alignment, calls, options?.trial));
    const client: DescriptionClient = { describe, bringOut: vi.fn(), dispose: vi.fn() };
    /** The runs made of the document itself, without those tried for the expert or for the match. */
    const plainRuns = () => describe.mock.calls.filter(([, , options]) => options?.trial === undefined);
    return { client, describe, plainRuns };
};

// ---------------------------------------------------------------------------------------------
// The expert, scripted
// ---------------------------------------------------------------------------------------------

/** An expert that answers when the test says so, and with what. */
const scriptedExpert = () => {
    const asked: { request: ExpertRequest; progress?: (line: string) => void; signal?: AbortSignal; settle: (answer: ExpertAnswer) => void; fail: (reason: ExpertFailure) => void }[] = [];
    const expert: Expert = {
        ask: (request, options) =>
            new Promise<ExpertAnswer>((resolve, reject) => {
                const fail = (reason: ExpertFailure) => reject(Object.assign(new Error(reason), { reason }));
                options?.signal?.addEventListener('abort', () => fail('stopped'));
                asked.push({ request, progress: options?.onProgress, signal: options?.signal, settle: resolve, fail });
            }),
    };
    /** Answer the question asked last. */
    const answer = async (steps: Step[], question: string | null = null) => {
        await act(async () => {
            asked.at(-1)?.settle({ steps, question, model: 'scripted-expert' });
            await Promise.resolve();
        });
    };
    const fail = async (reason: ExpertFailure) => {
        await act(async () => {
            asked.at(-1)?.fail(reason);
            await Promise.resolve();
        });
    };
    return { expert, asked, answer, fail };
};

// ---------------------------------------------------------------------------------------------
// The piano, scripted
// ---------------------------------------------------------------------------------------------

interface Heard {
    playing: boolean;
    hearing: Hearing;
    brought: string | null;
    strength: number;
    moved: ReadonlyMap<string, Sounded> | null;
}

/**
 * A piano that keeps what it is told and sounds nothing: what it shows is the script's own, so a
 * test can say where a remark brought out has the notes, or where the line is.
 */
const pianoScript = () => {
    let heard: Heard = { playing: false, hearing: 'played', brought: null, strength: 1.5, moved: null };
    let at = 0;
    const watching = new Set<() => void>();
    const following = new Set<() => void>();
    const show = (change: Partial<Heard>) => {
        heard = { ...heard, ...change };
        for (const listener of [...watching]) listener();
    };
    const setLine = (ms: number) => {
        at = ms;
        for (const listener of [...following]) listener();
    };
    const inputs: PlaybackInput[] = [];
    return {
        inputs,
        /** What the desk handed the piano at its last render. */
        hand: (input: PlaybackInput) => void inputs.push(input),
        subscribe: (listener: () => void) => {
            watching.add(listener);
            return () => watching.delete(listener);
        },
        read: () => heard,
        /** Put the notes where a remark brought out has them. */
        move: (moved: Heard['moved']) => show({ moved }),
        setLine,
        toggle: vi.fn(() => show({ playing: !heard.playing })),
        stop: vi.fn(() => show({ playing: false })),
        seek: vi.fn((ms: number) => setLine(ms)),
        bring: vi.fn((remark: string | null) => show({ brought: remark, ...(remark === null && { moved: null }) })),
        setHearing: (hearing: Hearing) => show({ hearing }),
        setStrength: (strength: number) => show({ strength }),
        line: {
            subscribe: (listener: () => void) => {
                following.add(listener);
                return () => following.delete(listener);
            },
            read: () => at,
        },
    };
};

const useScriptedPlayback = (script: ReturnType<typeof pianoScript>, input: PlaybackInput): DescribePlayback => {
    const heard = useSyncExternalStore(script.subscribe, script.read);
    useEffect(() => {
        script.hand(input);
    });
    const { toggle, stop, seek, bring, setHearing, setStrength, line } = script;
    return { ...heard, pending: false, toggle, stop, seek, bring, setHearing, setStrength, line };
};

// ---------------------------------------------------------------------------------------------
// The desk, mounted
// ---------------------------------------------------------------------------------------------

const describeCall = (id: string, text: string, over: Record<string, unknown> = {}): Call => ({
    id,
    name: 'Describe',
    options: { text, about: { kind: 'piece', from: 0, to: 2880, notes: [] }, model: null, date: '2026-11-01T10:00:00.000Z', steps: [], calls: [], ...over },
});

const TEMPO: Step = { name: 'FitTempo', options: { scope: 'global', from: 0, to: 2880, beatLength: 0.25 } };

interface MountOptions {
    calls?: Call[];
    editable?: boolean;
    /** The reader's key, or none. */
    expertKey?: string | null;
    /** Why the worker refuses the document, if it does. */
    refused?: string;
    /** How the run says a note arrived, before the corrections: by the note's id. */
    arrived?: Readonly<Record<string, Sounded>>;
    /**
     * Mount `DescribeDesk` itself, as the Desk does: the reader's key from the browser and the
     * Desk's piano, with only what reaches outside the page given from here.
     */
    registered?: boolean;
}

const mount = ({ calls = [], editable = true, expertKey = 'a-key', refused, arrived, registered = false }: MountOptions = {}) => {
    const description = scriptedClient(arrived);
    if (refused !== undefined) description.describe.mockRejectedValue(new Error(refused));
    const expert = scriptedExpert();
    const piano = pianoScript();
    const focusCall = vi.fn();
    const createExpert = vi.fn<DescribeServices['createExpert']>(() => expert.expert);
    let ids = 0;
    const services: DescribeServices = {
        session: createSession(() => description.client),
        createExpert,
        expertModel: 'scripted-expert',
        leftIn,
        now: () => '2026-11-28T12:00:00.000Z',
        newId: () => `r${String(++ids)}`,
    };
    const pristine = piece();
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const held: {
        history: WorkHistory;
        dispatch: (action: Parameters<typeof workHistoryReducer>[1]) => void;
        /** Open another desk in this one's place, or come back to it. */
        show: (open: boolean) => void;
    } = { history: initialHistory(), dispatch: () => undefined, show: () => undefined };
    const zoom = { symbolic: { stretchX: 0.5 }, physical: { stretchX: 100 }, setStretchX: () => undefined };

    const Desk = () => {
        const [key, setKey] = useState(expertKey);
        const told = useRemarks(services, key);
        const playback = useScriptedPlayback(piano, { run: told.run, places: told.places, client: services.session.client });
        return <DescribeSurface told={told} playback={playback} expertKey={key} onExpertKey={setKey} services={services} />;
    };

    const Registered = () => (
        <PlaybackProvider scoreMsm="" performanceMpm="" dateByNoteId={new Map()}>
            <DescribeServicesContext value={services}>
                <DescribeDesk />
            </DescribeServicesContext>
        </PlaybackProvider>
    );

    const Harness = () => {
        const work: WorkFile = { name: 'Four notes', mei: '', mpm: '', provenance: calls };
        const [history, dispatch] = useReducer(workHistoryReducer, initialHistory(work));
        const [open, setOpen] = useState(true);
        useEffect(() => {
            held.history = history;
            held.dispatch = dispatch;
        }, [history, dispatch]);
        useEffect(() => {
            held.show = setOpen;
        }, []);
        return (
            <ThemeProvider theme={theme}>
                <EditingContext value={editable}>
                    <WorkDocumentProvider history={history} dispatch={dispatch}>
                        <ScoreDocumentProvider mei="" setMei={vi.fn()} recording="" pristine={pristine}>
                            <ZoomContext value={zoom}>
                                <ScrollSyncProvider symbolicZoom={0.5} physicalZoom={100}>
                                    <CallSelectionProvider
                                        calls={history.present.provenance}
                                        outcomes={[]}
                                        activeCallIds={new Set()}
                                        setActiveCallIds={vi.fn()}
                                        onRemoveCalls={vi.fn()}
                                        focusCall={focusCall}
                                    >
                                        <DeskToolbarProvider target={bar}>{open && (registered ? <Registered /> : <Desk />)}</DeskToolbarProvider>
                                    </CallSelectionProvider>
                                </ScrollSyncProvider>
                            </ZoomContext>
                        </ScoreDocumentProvider>
                    </WorkDocumentProvider>
                </EditingContext>
            </ThemeProvider>
        );
    };

    const view = render(<Harness />);
    const one = <T extends Element = SVGElement>(selector: string): T => {
        const found = document.querySelector<T>(selector);
        if (!found) throw new Error(`nothing drawn for ${selector}`);
        return found;
    };
    const roll = () => one<SVGSVGElement>('[data-layer="roll"]');
    const boxOf = (id: string) => {
        const rect = one(`[data-note="${id}"]`);
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => Number(rect.getAttribute(name)));
        return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    };
    const at = (x: number, y: number, init: object = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, ...init });
    /** A level stroke under the notes from one second of the recording to another. */
    const bracket = (fromMs: number, toMs: number) => {
        const y = boxOf('low').cy - 60;
        fireEvent.pointerDown(roll(), at(fromMs / 10, y));
        fireEvent.pointerMove(roll(), at((fromMs + toMs) / 20, y + 2));
        fireEvent.pointerUp(roll(), at(toMs / 10, y + 2));
    };
    const click = (x: number, y: number, init?: object) => {
        fireEvent.pointerDown(roll(), at(x, y, init));
        fireEvent.pointerUp(roll(), at(x, y, init));
    };
    const pen = () => screen.getByLabelText<HTMLTextAreaElement>('Your remark');
    /** Write in the pen that is open, and send it. */
    const say = (text: string) => {
        fireEvent.change(pen(), { target: { value: text } });
        fireEvent.keyDown(pen(), { key: 'Enter' });
    };
    /** Everything the document holds, and the remarks among it. */
    const document_ = () => held.history.present.provenance;
    const remarks = () => document_().filter((call) => call.name === 'Describe');
    const undo = () => act(() => held.dispatch({ type: 'undo' }));
    const settled = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const card = () => within(one<HTMLElement>('[data-remark-card]'));

    return { ...view, ...description, ...expert, piano, focusCall, createExpert, services, bar, held, one, roll, boxOf, bracket, click, pen, say, calls: document_, remarks, undo, settled, card };
};

/** The roll is drawn once the first run is in. */
const drawn = () => screen.findByLabelText(/Piano roll on the recording's clock/);

describe('the describe desk shows the document', () => {
    it('runs the document and draws its roll: the notes where the run renders them, each over its shadow', async () => {
        const desk = mount();
        await drawn();
        expect(desk.plainRuns()).toHaveLength(1);
        expect(document.querySelectorAll('[data-note]')).toHaveLength(5);
        // Rendered a tenth of a second late with nothing described, at a hundred pixels to the second.
        expect(desk.boxOf('a').x).toBeCloseTo(110, 6);
        expect(document.querySelectorAll('[data-shadow]')).toHaveLength(5);
        // The spelling and the staff are the score's: middle-register C in the bass has its staff.
        expect(desk.boxOf('low').cy).toBeGreaterThan(desk.boxOf('a').cy);
        // One bar, and its tempo only assumed.
        expect(desk.one('[data-bar="1"]').textContent).toBe('1');
        expect(desk.one('[data-bars="assumed"]').getAttribute('d')).not.toBe('');
    });

    it('shows the remarks the document holds, each in the state the run and the asking leave it', async () => {
        mount({
            calls: [
                describeCall('whole', 'steady throughout', { model: 'someone', steps: [TEMPO] }),
                describeCall('part', 'bring this out', { about: { kind: 'span', from: 720, to: 2160, notes: [] }, model: 'someone', steps: [{ name: 'Broken', options: {} }] }),
                describeCall('kept', 'something else'),
            ],
        });
        await drawn();
        expect(screen.getByText('steady throughout').closest('[data-layer="lanes"]')).not.toBeNull();
        expect(screen.getByText('bring this out').closest('[data-said="part"]')).not.toBeNull();
        expect(document.querySelector('[data-remark="whole"]')?.getAttribute('data-state')).toBe('done');
        // A step that did not run, and words nothing has come of: both are marked.
        expect(document.querySelector('[data-remark="part"]')?.getAttribute('data-state')).toBe('trouble');
        expect(document.querySelector('[data-remark="kept"]')?.getAttribute('data-state')).toBe('trouble');
    });

    it('outlines a note where it arrived, but not for what the document did to every note alike', async () => {
        // Every note arrived at 80 and stands at 64: the roll's loudness is read on another scale.
        // One of them arrived a tenth of a second sooner as well, and was put right by hand.
        const scale: Call = { id: 'scale', name: 'Modify', options: { scope: 'global', aspect: 'velocity', points: [[0, 0], [80, 64]] } };
        const later: Call = { id: 'later', name: 'Modify', options: { scope: 'global', aspect: 'onset', change: 100, noteIDs: ['b'] } };
        const was = (id: string, sooner = 0) => {
            const { 'milliseconds.date': ms, 'milliseconds.date.end': msEnd } = piece().allNotes.find((each) => each['xml:id'] === id)!;
            return { ms: ms - sooner, msEnd: msEnd - sooner, velocity: 80 };
        };
        mount({ calls: [scale, later], arrived: { a: was('a'), b: was('b', 100), c: was('c'), d: was('d'), low: was('low') } });
        await drawn();
        expect([...document.querySelectorAll('[data-arrived]')].map((outline) => outline.getAttribute('data-arrived'))).toEqual(['b']);
    });

    it('says why there is no roll where the readings still stand side by side, and writes nothing', async () => {
        const desk = mount({
            calls: [describeCall('r', 'steady', { steps: [TEMPO] })],
            refused: '12 notes still stand on more than one reading: choose the take to read before describing it',
        });
        await waitFor(() => expect(desk.one<HTMLElement>('[data-status]').textContent).toMatch(/12 notes still stand on more than one reading/));
        expect(document.querySelector('[data-layer="roll"]')).toBeNull();
        expect(desk.calls()).toHaveLength(1);
        expect(desk.held.history.past).toHaveLength(0);
    });
});

describe('the describe desk writes what a run came to', () => {
    it('writes the calls a remark resolves to after it, as one edit', async () => {
        const desk = mount({ calls: [describeCall('r', 'steady', { model: 'someone', steps: [TEMPO] })] });
        await drawn();
        await waitFor(() => expect(desk.calls().map((call) => call.id)).toEqual(['r', 'r.0.0']));
        expect(desk.remarks()[0].options['calls']).toEqual(['r.0.0']);
        expect(desk.calls()[1]).toMatchObject({ name: 'InsertTempo', options: TEMPO.options });
        expect(desk.held.history.past).toHaveLength(1);
    });

    it('changes nothing, runs nothing again and leaves no step of undo where the document already says it', async () => {
        const resolved: Call[] = [
            { id: 'by-hand', name: 'InsertDynamics', options: { scope: 'global', from: 0, to: 720 } },
            describeCall('r', 'steady', { model: 'someone', steps: [TEMPO], calls: ['r.0.0'] }),
            { id: 'r.0.0', name: 'InsertTempo', options: TEMPO.options },
        ];
        const desk = mount({ calls: resolved });
        await drawn();
        await desk.settled();
        expect(desk.held.history.present.provenance).toBe(resolved);
        expect(desk.held.history.past).toHaveLength(0);
        expect(desk.plainRuns()).toHaveLength(1);
    });

    it('does not run again for its own writing, nor write a second time', async () => {
        const desk = mount({ calls: [describeCall('r', 'steady', { model: 'someone', steps: [TEMPO] })] });
        await drawn();
        await waitFor(() => expect(desk.calls()).toHaveLength(2));
        await desk.settled();
        // What a run is a function of did not change by writing its result.
        expect(desk.plainRuns()).toHaveLength(1);
        expect(desk.held.history.past).toHaveLength(1);
    });

    it('puts the remarks after the calls made by hand, in their own order, each with what it owns', async () => {
        const desk = mount({
            calls: [
                describeCall('one', 'steady', { model: 'someone', steps: [TEMPO] }),
                { id: 'by-hand', name: 'InsertDynamics', options: { scope: 'global', from: 0, to: 720 } },
                describeCall('two', 'and again', { model: 'someone', steps: [TEMPO, TEMPO] }),
            ],
        });
        await drawn();
        await waitFor(() => expect(desk.calls().map((call) => call.id)).toEqual(['by-hand', 'one', 'one.0.0', 'two', 'two.0.0', 'two.1.0']));
    });

    it('leaves a state of the document that undo brought back as it is', async () => {
        const desk = mount({ calls: [describeCall('r', 'steady', { model: 'someone', steps: [TEMPO] })] });
        await drawn();
        await waitFor(() => expect(desk.calls()).toHaveLength(2));
        desk.undo();
        await desk.settled();
        // Written over again, the step just undone would come back every time.
        expect(desk.calls().map((call) => call.id)).toEqual(['r']);
        expect(desk.held.history.future).toHaveLength(1);
    });

    it('reads a remark the prototype saved, whose calls are its steps, and writes it as remarks are written now', async () => {
        const legacy: Call[] = [
            { id: 'old', name: 'Describe', options: { text: 'steady tempo on half bars', about: { kind: 'span', from: 0, to: 2880, notes: [] }, model: 'claude-opus-5-5', date: '2026-11-27T00:00:00.000Z', calls: ['old:0', 'old:1'] } },
            { id: 'old:0', name: 'FitTempo', options: { scope: 'global', from: 0, to: 1440, beatLength: 0.25 } },
            { id: 'old:1', name: 'InsertRubato', options: { scope: 'global', date: 0, length: 720 } },
        ];
        const desk = mount({ calls: legacy });
        await drawn();
        await waitFor(() => expect(desk.calls().map((call) => call.id)).toEqual(['old', 'old.0.0', 'old.1.0']));
        // What it owned was passed over on the run; it was run by its steps, which are those calls.
        const [, input] = desk.plainRuns()[0];
        expect(input.find((call) => call.id === 'old')?.options['steps']).toEqual([
            { name: 'FitTempo', options: legacy[1].options },
            { name: 'InsertRubato', options: legacy[2].options },
        ]);
        expect(desk.remarks()[0].options).toMatchObject({
            text: 'steady tempo on half bars',
            model: 'claude-opus-5-5',
            steps: [
                { name: 'FitTempo', options: legacy[1].options },
                { name: 'InsertRubato', options: legacy[2].options },
            ],
            calls: ['old.0.0', 'old.1.0'],
        });
        expect(desk.calls()[1]).toMatchObject({ name: 'InsertTempo' });
        expect(desk.held.history.past).toHaveLength(1);
    });
});

describe('the describe desk makes a remark', () => {
    it('writes the remark into the document the moment it is said, before anyone has answered', async () => {
        const desk = mount();
        await drawn();
        desk.bracket(1900, 3100);
        expect(desk.pen()).toHaveFocus();
        expect(desk.pen().placeholder).toBe('about bar 1…');
        desk.say('  growing here ');
        expect(desk.remarks()).toEqual([
            {
                id: 'r1',
                name: 'Describe',
                options: {
                    text: 'growing here',
                    // A passage is told by its stretch, from the first note taken to the next date after the last.
                    about: { kind: 'span', from: 720, to: 2160, notes: [] },
                    model: null,
                    date: '2026-11-28T12:00:00.000Z',
                    steps: [],
                    calls: [],
                },
            },
        ]);
        expect(screen.queryByLabelText('Your remark')).toBeNull();
        expect(await screen.findByText('growing here')).toBeInTheDocument();
        // Asked, and shown as waiting for its answer.
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('pending');
    });

    it('shows the expert the remark, the others, the document as it stands, and lets it try steps out', async () => {
        const desk = mount({
            calls: [
                { id: 'by-hand', name: 'InsertDynamics', options: { scope: 'global', from: 0, to: 720 } },
                describeCall('before', 'steady', { model: 'someone', steps: [TEMPO] }),
            ],
        });
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say('rolled chords');
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        const { request } = desk.asked[0];
        expect(request.remark).toEqual({ id: 'r1', text: 'rolled chords', about: { kind: 'piece', from: 0, to: 2880, notes: [] }, steps: [] });
        expect(request.others).toEqual([{ id: 'before', text: 'steady', about: { kind: 'piece', from: 0, to: 2880, notes: [] }, steps: [TEMPO] }]);
        expect(request.thread).toEqual([]);
        expect(request.mend).toBeUndefined();
        // What was made by hand on other desks, and nothing a remark owns.
        expect(request.byHand).toEqual([{ id: 'by-hand', name: 'InsertDynamics', options: { scope: 'global', from: 0, to: 720 } }]);
        expect(request.piece).toEqual({ title: '', ppq: 720, bars: [{ n: 1, from: 0, to: 2880 }] });
        expect(request.run.roll.notes).toHaveLength(5);
        // Trying steps out is a run with them in the remark's place, and nothing of it is kept.
        const tried = await request.tryOut([TEMPO]);
        expect(tried.remarks.find((report) => report.id === 'r1')?.concrete).toHaveLength(1);
        expect(desk.describe.mock.calls.at(-1)?.[2]).toEqual({ trial: { remark: 'r1', steps: [TEMPO] } });
        expect(desk.remarks().find((call) => call.id === 'r1')?.options['steps']).toEqual([]);
    });

    it('writes the answer and what it resolves to in one edit', async () => {
        const desk = mount();
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say('steady throughout');
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        const before = desk.held.history.past.length;
        await desk.answer([TEMPO]);
        await waitFor(() => expect(desk.calls().map((call) => call.id)).toEqual(['r1', 'r1.0.0']));
        expect(desk.remarks()[0].options).toMatchObject({ model: 'scripted-expert', steps: [TEMPO], calls: ['r1.0.0'] });
        // Steps and calls came together: one step of undo, back to the words alone.
        expect(desk.held.history.past).toHaveLength(before + 1);
        desk.undo();
        expect(desk.calls().map((call) => call.id)).toEqual(['r1']);
        expect(desk.remarks()[0].options).toMatchObject({ model: null, steps: [], calls: [] });
    });

    it('shows the remark done, and the notes where the document now has them', async () => {
        const desk = mount();
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say('steady throughout');
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        expect(desk.boxOf('a').x).toBeCloseTo(110, 6);
        await desk.answer([TEMPO]);
        await waitFor(() => expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('done'));
        // Described, the notes cover their shadows, and no tempo is assumed any more.
        expect(desk.boxOf('a').x).toBe(100);
        expect(document.querySelectorAll('[data-shadow]')).toHaveLength(0);
        expect(desk.one('[data-bars="assumed"]').getAttribute('d')).toBe('');
    });

    it('asks one remark at a time, in the order they were made', async () => {
        const desk = mount();
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say('first');
        desk.bracket(1900, 3100);
        desk.say('second');
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        expect(desk.asked[0].request.remark.text).toBe('first');
        expect(desk.one<HTMLElement>('[data-status]').textContent).toBe('Reading “first”, 1 more waiting. You can go on writing.');
        await desk.answer([TEMPO]);
        await waitFor(() => expect(desk.asked).toHaveLength(2));
        expect(desk.asked[1].request.remark.text).toBe('second');
        // The second is shown the document with the first one's answer in it.
        expect(desk.asked[1].request.others[0]).toMatchObject({ id: 'r1', steps: [TEMPO] });
    });

    it('drops what is being written on Esc, and keeps nothing of it', async () => {
        const desk = mount();
        await drawn();
        desk.bracket(1900, 3100);
        fireEvent.change(desk.pen(), { target: { value: 'never mind' } });
        expect(document.querySelector('[data-draft]')).not.toBeNull();
        fireEvent.keyDown(desk.pen(), { key: 'Escape' });
        expect(screen.queryByLabelText('Your remark')).toBeNull();
        expect(document.querySelector('[data-draft]')).toBeNull();
        expect(desk.calls()).toEqual([]);
    });

    it('takes a note that is clicked, adds another with shift, and lets one go the same way', async () => {
        const desk = mount();
        await drawn();
        const [a, c] = [desk.boxOf('a'), desk.boxOf('c')];
        desk.click(a.cx, a.cy);
        expect(desk.pen().placeholder).toBe('about this note…');
        desk.click(c.cx, c.cy, { shiftKey: true });
        expect(desk.pen().placeholder).toBe('about these 2 notes…');
        desk.click(a.cx, a.cy, { shiftKey: true });
        expect(desk.pen().placeholder).toBe('about this note…');
        desk.say('held over');
        expect(desk.remarks()[0].options['about']).toEqual({ kind: 'notes', from: 1440, to: 2160, notes: ['c'] });
    });

    it('starts a remark about the whole piece from whatever is typed with nothing in hand', async () => {
        const desk = mount();
        await drawn();
        fireEvent.keyDown(document.body, { key: 'a' });
        expect(desk.pen()).toHaveValue('a');
        expect(desk.pen().placeholder).toBe('about the whole piece…');
        // Nor does a shortcut start one.
        fireEvent.keyDown(desk.pen(), { key: 'Escape' });
        fireEvent.keyDown(document.body, { key: 's', metaKey: true });
        expect(screen.queryByLabelText('Your remark')).toBeNull();
    });
});

describe('the describe desk and the expert', () => {
    const asking = async (text = 'steady throughout') => {
        const desk = mount();
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say(text);
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        return desk;
    };
    const callUp = (text: string) => fireEvent.click(screen.getByText(text));

    it('shows what the expert asks on the remark, and asks again with the answer in the thread', async () => {
        const desk = await asking('broaden');
        await desk.answer([], 'Over which bars?');
        await waitFor(() => expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('question'));
        // A question changes nothing in the document.
        expect(desk.remarks()[0].options).toMatchObject({ steps: [], model: null });
        callUp('broaden');
        expect(desk.card().getByText('Over which bars?')).toBeInTheDocument();
        const field = desk.card().getByLabelText('Your answer');
        fireEvent.change(field, { target: { value: 'the last two' } });
        fireEvent.keyDown(field, { key: 'Enter' });
        await waitFor(() => expect(desk.asked).toHaveLength(2));
        expect(desk.asked[1].request.thread).toEqual([{ question: 'Over which bars?', answer: 'the last two' }]);
        expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('pending');
        await desk.answer([TEMPO]);
        await waitFor(() => expect(desk.calls().map((call) => call.id)).toEqual(['r1', 'r1.0.0']));
        expect(desk.card().queryByText('Over which bars?')).toBeNull();
    });

    it('sends steps the chain refused back once for mending, with what it said of them', async () => {
        const desk = await asking();
        await desk.answer([TEMPO, { name: 'Broken', options: {} }]);
        await waitFor(() => expect(desk.asked).toHaveLength(2));
        // The answer is in the document all the same: what ran of it is kept.
        expect(desk.calls().map((call) => call.id)).toEqual(['r1', 'r1.0.0']);
        expect(desk.asked[1].request.mend).toEqual(['step 2 (Broken): there is nothing there to fit']);
        expect(desk.asked[1].request.remark.steps).toEqual([TEMPO, { name: 'Broken', options: {} }]);
        // Mended badly, it is not sent a third time, and the remark says something is wrong with it.
        await desk.answer([{ name: 'Broken', options: {} }]);
        await waitFor(() => expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('trouble'));
        await desk.settled();
        expect(desk.asked).toHaveLength(2);
        callUp('steady throughout');
        expect(desk.card().getByText(/Broken did not run: there is nothing there to fit/)).toBeInTheDocument();
    });

    it('takes an answer that says again what the remark already holds, and moves on to the next', async () => {
        const desk = await asking();
        await desk.answer([TEMPO]);
        await waitFor(() => expect(desk.calls()).toHaveLength(2));
        callUp('steady throughout');
        fireEvent.click(desk.card().getByRole('button', { name: 'Ask again' }));
        await waitFor(() => expect(desk.asked).toHaveLength(2));
        const runs = desk.plainRuns().length;
        const steps = desk.held.history.past.length;
        await desk.answer([TEMPO]);
        // Nothing to run and nothing to write: but the answer is taken, and nothing waits on it.
        await waitFor(() => expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('done'));
        expect(desk.services.session.asking.read().get('r1')?.answer).toBeNull();
        expect(desk.plainRuns()).toHaveLength(runs);
        expect(desk.held.history.past).toHaveLength(steps);
    });

    it('takes a mended answer that runs', async () => {
        const desk = await asking();
        await desk.answer([{ name: 'Broken', options: {} }]);
        await waitFor(() => expect(desk.asked).toHaveLength(2));
        await desk.answer([TEMPO]);
        await waitFor(() => expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('done'));
        expect(desk.remarks()[0].options).toMatchObject({ steps: [TEMPO], calls: ['r1.0.0'] });
    });

    it('says in plain words why no answer came, and asks again when told to', async () => {
        const desk = await asking();
        await desk.fail('busy');
        await waitFor(() => expect(document.querySelector('[data-remark="r1"]')?.getAttribute('data-state')).toBe('trouble'));
        callUp('steady throughout');
        expect(desk.card().getByText(/too many requests just now/)).toBeInTheDocument();
        fireEvent.click(desk.card().getByRole('button', { name: 'Ask again' }));
        await waitFor(() => expect(desk.asked).toHaveLength(2));
        expect(desk.card().queryByText(/too many requests/)).toBeNull();
    });

    it('stops an asking under way, and says that it was stopped', async () => {
        const desk = await asking();
        callUp('steady throughout');
        expect(desk.card().getByText('Reading the remark…')).toBeInTheDocument();
        act(() => desk.asked[0].progress?.('Trying 2 steps on the roll…'));
        expect(desk.card().getByText('Trying 2 steps on the roll…')).toBeInTheDocument();
        fireEvent.click(desk.card().getByRole('button', { name: 'Stop' }));
        expect(desk.asked[0].signal?.aborted).toBe(true);
        expect(await desk.card().findByText('Stopped before an answer came.')).toBeInTheDocument();
        expect(desk.remarks()).toHaveLength(1);
    });

    it('asks again when the words of a remark are changed, and lets what it had become go', async () => {
        const desk = await asking();
        await desk.answer([TEMPO]);
        await waitFor(() => expect(desk.calls()).toHaveLength(2));
        callUp('steady throughout');
        const words = desk.card().getByLabelText('The remark');
        fireEvent.change(words, { target: { value: 'slowing towards the end' } });
        fireEvent.blur(words);
        expect(desk.calls()).toHaveLength(1);
        expect(desk.remarks()[0].options).toMatchObject({ text: 'slowing towards the end', model: null, steps: [], calls: [] });
        await waitFor(() => expect(desk.asked).toHaveLength(2));
        expect(desk.asked[1].request.remark).toMatchObject({ text: 'slowing towards the end', steps: [] });
        expect(desk.asked[1].request.thread).toEqual([]);
    });

    it('says who answered and when, and what each step became, as links to the calls', async () => {
        const desk = mount({
            calls: [
                describeCall('r', 'steady, then rubato', {
                    model: 'claude-opus-5-5',
                    steps: [TEMPO, { name: 'Withheld', options: {} }, { name: 'Broken', options: {} }],
                }),
            ],
        });
        await drawn();
        await waitFor(() => expect(desk.calls()).toHaveLength(2));
        callUp('steady, then rubato');
        const card = desk.card();
        expect(card.getByText(/the whole piece · claude-opus-5-5 · /)).toBeInTheDocument();
        expect(card.getByText(/wrote tempo/)).toBeInTheDocument();
        // What ran and was written is a link to the call it became; a click goes to that call.
        fireEvent.click(card.getByRole('button', { name: 'InsertTempo' }));
        expect(desk.focusCall).toHaveBeenCalledExactlyOnceWith('r.0.0');
        // What ran in the picture and is kept out, and what did not run, each in plain words.
        expect(card.getByText(/Withheld is in the picture here but kept out of the document: InsertRubato needs an InsertTempo/)).toBeInTheDocument();
        expect(card.getByText(/Broken did not run: there is nothing there to fit/)).toBeInTheDocument();
    });

    it('deletes a remark with everything it became, as one edit', async () => {
        const desk = mount({
            calls: [
                describeCall('gone', 'steady', { model: 'someone', steps: [TEMPO, TEMPO] }),
                describeCall('stays', 'and this', { model: 'someone', steps: [TEMPO] }),
            ],
        });
        await drawn();
        await waitFor(() => expect(desk.calls()).toHaveLength(5));
        const before = desk.held.history.past.length;
        callUp('steady');
        fireEvent.click(desk.card().getByRole('button', { name: 'Delete' }));
        expect(desk.calls().map((call) => call.id)).toEqual(['stays', 'stays.0.0']);
        expect(desk.held.history.past).toHaveLength(before + 1);
        expect(document.querySelector('[data-remark-card]')).toBeNull();
        await waitFor(() => expect(screen.queryByText('steady')).toBeNull());
        desk.undo();
        expect(desk.calls().map((call) => call.id)).toEqual(['gone', 'gone.0.0', 'gone.1.0', 'stays', 'stays.0.0']);
    });

    it('forgets what was being asked of a remark that is deleted', async () => {
        const desk = await asking();
        callUp('steady throughout');
        fireEvent.click(desk.card().getByRole('button', { name: 'Delete' }));
        expect(desk.asked[0].signal?.aborted).toBe(true);
        await desk.answer([TEMPO]);
        await desk.settled();
        expect(desk.calls()).toEqual([]);
    });
});

describe('the describe desk without a key', () => {
    it('records the remark all the same, asks nobody, and says so where the remark is called up', async () => {
        const desk = mount({ expertKey: null });
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        expect(screen.getByText(/Without a key it is not turned into steps/)).toBeInTheDocument();
        desk.say('steady throughout');
        expect(desk.remarks()).toHaveLength(1);
        expect(desk.remarks()[0].options).toMatchObject({ text: 'steady throughout', steps: [], model: null });
        await desk.settled();
        expect(desk.asked).toHaveLength(0);
        fireEvent.click(await screen.findByText('steady throughout'));
        expect(desk.card().getByText(/This remark has not been turned into steps: there is no key to ask the expert with/)).toBeInTheDocument();
        expect(desk.card().queryByRole('button', { name: /Ask/ })).toBeNull();
    });

    it('offers the key there, says what happens with it, and asks once there is one', async () => {
        const desk = mount({ expertKey: null, calls: [describeCall('kept', 'steady throughout')] });
        await drawn();
        fireEvent.click(screen.getByText('steady throughout'));
        const card = desk.card();
        expect(card.getByText(/kept in this browser only, never in the document/)).toBeInTheDocument();
        expect(card.getByText(/sent to Anthropic’s API together with the remark, the notes of the piece and what has been described so far/)).toBeInTheDocument();
        fireEvent.change(card.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-test' } });
        fireEvent.click(card.getByRole('button', { name: 'Keep it' }));
        fireEvent.click(desk.card().getByRole('button', { name: 'Ask the expert' }));
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        expect(desk.asked[0].request.remark.text).toBe('steady throughout');
    });

    it('has the key on the toolbar too, and forgets it there', async () => {
        const desk = mount({ expertKey: 'sk-ant-abcd' });
        await drawn();
        fireEvent.click(within(desk.bar).getByRole('button', { name: 'Expert' }));
        expect(screen.getByText('A key is kept, ending in abcd.')).toBeInTheDocument();
        // The key itself is not shown again.
        expect(document.body.textContent).not.toContain('sk-ant-abcd');
        fireEvent.click(screen.getByRole('button', { name: 'Forget it' }));
        expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument();
    });
});

describe('the describe desk lets the roll be heard', () => {
    const TOLD = [describeCall('r', 'steady', { about: { kind: 'span', from: 0, to: 1440, notes: [] }, model: 'someone', steps: [TEMPO], calls: ['r.0.0'] }), { id: 'r.0.0', name: 'InsertTempo', options: TEMPO.options }];

    it('hands the piano the run and where each remark was made', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        const input = desk.piano.inputs.at(-1);
        expect(input?.run?.roll.notes).toHaveLength(5);
        expect([...(input?.places ?? [])]).toEqual([['r', { kind: 'span', from: 0, to: 1440, notes: [] }]]);
        expect(input?.client).toBe(desk.services.session.client);
    });

    it('plays and stops on Space and from the toolbar', async () => {
        const desk = mount();
        await drawn();
        fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
        expect(desk.piano.toggle).toHaveBeenCalledTimes(1);
        fireEvent.click(within(desk.bar).getByRole('button', { name: 'Stop the roll' }));
        expect(desk.piano.toggle).toHaveBeenCalledTimes(2);
        expect(within(desk.bar).getByRole('button', { name: 'Play the roll' })).toBeInTheDocument();
    });

    it('leaves Space to the pen while a remark is being written', async () => {
        const desk = mount();
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        fireEvent.keyDown(desk.pen(), { key: ' ', code: 'Space' });
        expect(desk.piano.toggle).not.toHaveBeenCalled();
    });

    it('sets the line where nothing is clicked, and draws it there', async () => {
        const desk = mount();
        await drawn();
        expect(document.querySelector('[data-playhead]')).toBeNull();
        desk.click(350, desk.boxOf('low').cy - 60);
        expect(desk.piano.seek).toHaveBeenCalledExactlyOnceWith(3500);
        expect(desk.one('[data-playhead]').getAttribute('transform')).toBe('translate(350.5 0)');
        // The line is followed without the desk being drawn again: it is a store.
        act(() => desk.piano.setLine(4200));
        expect(desk.one('[data-playhead]').getAttribute('transform')).toBe('translate(420.5 0)');
    });

    it('switches what is heard, and how strongly a remark is brought out', async () => {
        const desk = mount();
        await drawn();
        const bar = within(desk.bar);
        expect(bar.getByRole('button', { name: 'as played' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(bar.getByRole('button', { name: 'as the MPM' }));
        expect(bar.getByRole('button', { name: 'as the MPM' })).toHaveAttribute('aria-pressed', 'true');
        expect(bar.getByRole('slider')).toHaveValue('1.5');
    });

    it('plays a remark brought out once the pointer has rested on it, and puts everything back when it leaves', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        fireEvent.pointerEnter(desk.one('[data-words="r"]'));
        // Lit at once, played only after a moment.
        expect(document.querySelector('[data-remark="r"]')?.getAttribute('data-lit')).toBe('true');
        expect(desk.piano.bring).not.toHaveBeenCalled();
        await waitFor(() => expect(desk.piano.bring).toHaveBeenCalledExactlyOnceWith('r'), { timeout: 1500 });
        expect(desk.one<HTMLElement>('[data-status]').textContent).toBe('Bringing out “steady”: what it wrote ×1.5, the rest held back.');
        fireEvent.pointerLeave(desk.one('[data-words="r"]'));
        await waitFor(() => expect(desk.piano.bring).toHaveBeenLastCalledWith(null), { timeout: 1500 });
    });

    it('does not play a remark the pointer only passes over', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        fireEvent.pointerEnter(desk.one('[data-words="r"]'));
        fireEvent.pointerLeave(desk.one('[data-words="r"]'));
        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(desk.piano.bring).not.toHaveBeenCalled();
    });

    it('does not interrupt the roll while it plays: resting on a remark then only lights it', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
        fireEvent.pointerEnter(desk.one('[data-words="r"]'));
        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(desk.piano.bring).not.toHaveBeenCalled();
        expect(document.querySelector('[data-remark="r"]')?.getAttribute('data-lit')).toBe('true');
    });

    it('moves the notes with the slider, and plays the remark again once the slider is let go', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        fireEvent.pointerEnter(desk.one('[data-words="r"]'));
        await waitFor(() => expect(desk.piano.bring).toHaveBeenCalledTimes(1), { timeout: 1500 });
        fireEvent.change(within(desk.bar).getByRole('slider'), { target: { value: '1.8' } });
        expect(within(desk.bar).getByRole('slider')).toHaveValue('1.8');
        expect(desk.piano.bring).toHaveBeenLastCalledWith('r');
        expect(desk.piano.bring).toHaveBeenCalledTimes(2);
        expect(desk.one<HTMLElement>('[data-status]').textContent).toMatch(/×1\.8/);
    });

    it('leaves a remark brought out while it is the one called up', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        fireEvent.click(screen.getByText('steady'));
        fireEvent.pointerEnter(desk.one('[data-words="r"]'));
        await waitFor(() => expect(desk.piano.bring).toHaveBeenCalledExactlyOnceWith('r'), { timeout: 1500 });
        fireEvent.pointerLeave(desk.one('[data-words="r"]'));
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(desk.piano.bring).toHaveBeenCalledTimes(1);
        // Put away, it goes back.
        fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
        expect(desk.piano.bring).toHaveBeenLastCalledWith(null);
        expect(document.querySelector('[data-remark-card]')).toBeNull();
    });

    it('draws the notes where a remark brought out has them, and puts them back', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        expect(desk.boxOf('b').x).toBe(200);
        act(() => desk.piano.move(new Map([['b', { ms: 2600, msEnd: 3500, velocity: 100 }]])));
        // The note goes there; its shadow, where it was played, stays; the others hold still.
        expect(desk.boxOf('b').x).toBe(260);
        expect(Number(desk.one('[data-shadow="b"]').getAttribute('x'))).toBeCloseTo(200.5, 6);
        expect(desk.boxOf('a').x).toBe(100);
        act(() => desk.piano.move(null));
        expect(desk.boxOf('b').x).toBe(200);
    });

    it('lights the notes a remark was fitted to, where the run knows them', async () => {
        const desk = mount({ calls: TOLD });
        await drawn();
        fireEvent.pointerEnter(desk.one('[data-words="r"]'));
        // The stretch holds a, b and the bass note; the run says it was fitted to b and c.
        const dimmed = [...document.querySelectorAll('[data-dim]')].map((rect) => rect.getAttribute('data-note')).sort();
        expect(dimmed).toEqual(['a', 'd', 'low']);
    });
});

describe('the describe desk shows how well the MPM matches the playing', () => {
    it('gives one figure, of what there was to explain that is explained', async () => {
        const desk = mount();
        await drawn();
        // Of the four, only the timing is off with nothing described: three quarters are there already.
        await waitFor(() => expect(desk.one<HTMLElement>('[data-match]').getAttribute('aria-label')).toBe('Match with the playing: 75 %'));
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say('steady throughout');
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        await desk.answer([TEMPO]);
        // Timing was a tenth of a second off and is on the note now; the other three were never off.
        await waitFor(() => expect(desk.one<HTMLElement>('[data-match]').getAttribute('aria-label')).toBe('Match with the playing: 100 %'));
    });

    it('opens under the pointer into the four it is made of', async () => {
        const desk = mount();
        await drawn();
        fireEvent.mouseOver(desk.one('[data-match]'));
        const parts = await screen.findByText('Timing');
        const meters = parts.closest('[data-match-parts]') as HTMLElement;
        expect([...meters.querySelectorAll('[data-meter]')].map((meter) => meter.getAttribute('data-meter'))).toEqual(['pulse', 'chords', 'loud', 'length']);
        expect(within(meters).getByText('100 ms')).toBeInTheDocument();
    });
});

describe('the describe desk in the viewer', () => {
    const PUBLISHED = [
        describeCall('r', 'steady', { about: { kind: 'span', from: 0, to: 1440, notes: [] }, model: 'claude-opus-5-5', steps: [TEMPO, { name: 'Broken', options: {} }] }),
    ];

    it('is the roll, the remarks and the hearing', async () => {
        const desk = mount({ calls: PUBLISHED, editable: false });
        await drawn();
        expect(document.querySelectorAll('[data-note]')).toHaveLength(5);
        expect(screen.getByText('steady')).toBeInTheDocument();
        // The remark is shown as it resolves, though nothing of that is in the document.
        expect(desk.boxOf('a').x).toBe(100);
        fireEvent.pointerEnter(desk.one('[data-words="r"]'));
        await waitFor(() => expect(desk.piano.bring).toHaveBeenCalledExactlyOnceWith('r'), { timeout: 1500 });
        fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
        expect(desk.piano.toggle).toHaveBeenCalledTimes(1);
    });

    it('writes nothing into the document, however the run resolves it', async () => {
        const desk = mount({ calls: PUBLISHED, editable: false });
        await drawn();
        await desk.settled();
        expect(desk.held.history.present.provenance).toBe(PUBLISHED);
        expect(desk.held.history.past).toHaveLength(0);
    });

    it('has no pen, no key and no line waiting to be written on', async () => {
        const desk = mount({ calls: PUBLISHED, editable: false });
        await drawn();
        expect(document.querySelector('[data-prompt]')).toBeNull();
        expect(within(desk.bar).queryByRole('button', { name: 'Expert' })).toBeNull();
        fireEvent.keyDown(document.body, { key: 'a' });
        desk.bracket(1900, 3100);
        const a = desk.boxOf('a');
        desk.click(a.cx, a.cy);
        expect(screen.queryByLabelText('Your remark')).toBeNull();
        expect(document.querySelector('[data-draft]')).toBeNull();
    });

    it('calls a remark up to be read, with nothing on it that would change it', async () => {
        const desk = mount({ calls: PUBLISHED, editable: false });
        await drawn();
        fireEvent.click(screen.getByText('steady'));
        const card = desk.card();
        expect(card.getByText(/bar 1 · claude-opus-5-5/)).toBeInTheDocument();
        expect(card.getByText(/Broken did not run/)).toBeInTheDocument();
        expect(card.queryByLabelText('The remark')).toBeNull();
        expect(card.queryByRole('button', { name: /Ask|Delete|Stop/ })).toBeNull();
        // The call a step became is not in the published document, so there is nothing to follow it to.
        fireEvent.click(card.getByRole('button', { name: 'InsertTempo' }));
        expect(desk.focusCall).toHaveBeenCalledExactlyOnceWith('r.0.0');
        expect(desk.asked).toHaveLength(0);
    });
});

describe('the describe desk outlasts being closed', () => {
    it('keeps what is being asked while another desk is open, and writes the answer once it is back', async () => {
        const desk = mount();
        await drawn();
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say('steady throughout');
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        const { asking } = desk.services.session;

        // The reader opens another desk: this one is gone, and what it was asking is not.
        act(() => desk.held.show(false));
        expect(document.querySelector('[data-describe-desk]')).toBeNull();
        expect(asking.read().get('r1')?.turn).toBe('asking');
        expect(desk.client.dispose).not.toHaveBeenCalled();

        // The answer comes while nobody is looking. It is kept, and the worker is let go.
        await desk.answer([TEMPO]);
        expect(asking.read().get('r1')?.answer).toEqual({ steps: [TEMPO], model: 'scripted-expert' });
        expect(desk.calls().map((call) => call.id)).toEqual(['r1']);
        expect(desk.client.dispose).toHaveBeenCalledTimes(1);

        // Back on the desk, it is run and written as it would have been.
        act(() => desk.held.show(true));
        await waitFor(() => expect(desk.calls().map((call) => call.id)).toEqual(['r1', 'r1.0.0']));
        expect(desk.remarks()[0].options).toMatchObject({ model: 'scripted-expert', steps: [TEMPO], calls: ['r1.0.0'] });
        expect(asking.read().get('r1')?.answer).toBeNull();
    });

    it('lets the worker go when the desk is closed with nothing being asked', async () => {
        const desk = mount();
        await drawn();
        act(() => desk.held.show(false));
        expect(desk.client.dispose).toHaveBeenCalledTimes(1);
    });
});

describe('the describe desk as the Desk opens it', () => {
    it('is the same desk, with the reader\'s own key from this browser and the Desk\'s piano', async () => {
        const desk = mount({ registered: true });
        await drawn();

        // No key is kept in this browser yet. It is given on the toolbar, and kept here.
        fireEvent.click(within(desk.bar).getByRole('button', { name: 'Expert' }));
        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-the-readers' } });
        fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
        expect(localStorage.getItem('mpm-desk.expert-key')).toBe('sk-ant-the-readers');
        expect(desk.calls()).toEqual([]);
        fireEvent.keyDown(screen.getByText(/^A key is kept, ending in/), { key: 'Escape', code: 'Escape' });
        await waitFor(() => expect(document.querySelector('[data-expert-key]')).toBeNull());

        // A remark is asked of the expert that key makes, and written as any is.
        fireEvent.click(desk.one('[data-prompt] rect'));
        desk.say('steady throughout');
        await waitFor(() => expect(desk.asked).toHaveLength(1));
        expect(desk.createExpert).toHaveBeenCalledWith('sk-ant-the-readers');
        await desk.answer([TEMPO]);
        await waitFor(() => expect(desk.calls().map((call) => call.id)).toEqual(['r1', 'r1.0.0']));

        // The roll plays on the piano the Desk has.
        const before = rig.played.length;
        fireEvent.click(within(desk.bar).getByRole('button', { name: 'Play the roll' }));
        expect(rig.played).toHaveLength(before + 1);
        fireEvent.click(await within(desk.bar).findByRole('button', { name: 'Stop the roll' }));
        expect(await within(desk.bar).findByRole('button', { name: 'Play the roll' })).toBeInTheDocument();

        // And the key is forgotten where it was given.
        fireEvent.click(within(desk.bar).getByRole('button', { name: 'Expert' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Forget it' }));
        expect(localStorage.getItem('mpm-desk.expert-key')).toBeNull();
    });
});
