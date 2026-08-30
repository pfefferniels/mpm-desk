import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import type { VerovioOptions } from 'verovio';

/**
 * The options of the vendored verovio fork, which can lay a score out along the performed time of
 * a `<recording>` instead of along notated durations. They are not part of `@types/verovio`; see
 * `vendor/verovio/README.md` and the fork's `src/options.cpp`.
 */
export interface PerformanceOptions {
    /** Take the position of each note from `<performance>` rather than from its duration */
    performanceAlignment?: boolean;
    /** The `<recording>` to lay out: a 1-based index, an `@xml:id` or a `@source` */
    performanceRecording?: string;
    /** The width given to one second of performed time, in MEI units */
    performanceScale?: number;
    /** The performed duration of one system in seconds; 0 puts everything on one system */
    performanceSystemDuration?: number;
    /** Cut systems by the clock, or only at barlines. Newer than the 2026-08-27 build. */
    performanceBreaks?: 'time' | 'measure';
    /** What to do with notes the recording has no `<when>` for */
    performanceUnmatched?: 'mark' | 'plain' | 'hide';
    /** Render the velocity of each note as ink density */
    performanceVelocityOpacity?: boolean;
    /** Draw a ruler of the performed time below each system */
    performanceRuler?: boolean;
}

export type ScoreOptions = VerovioOptions & PerformanceOptions;

/**
 * How the voices desk renders a score.
 *
 * Two of these are the desk's central decision rather than a preference. `performanceVelocityOpacity`
 * writes `opacity` onto the note's own `<g>` and `performanceUnmatched: 'mark'` writes
 * `fill="darkred"` onto it — the very element the part hue goes on. Hue is this desk's one channel
 * and it does not share, so both are off and the desk draws an unmatched note in its own way. The
 * `data-perf-unaligned` attribute survives `'plain'`, so nothing is lost by turning the paint off.
 */
export const defaultOptions: ScoreOptions = {
    adjustPageHeight: true,
    header: 'none',
    scale: 70,
    pageMarginBottom: 50,
    pageMarginRight: 50,
    // `data-id` and the `data-perf-*` attributes are only emitted for HTML5 SVG — and `data-id`,
    // not `id`, is what carries the raw MEI `xml:id`.
    svgHtml5: true,
    svgAdditionalAttribute: [
        // What a note is: which voice drew it, and which bar it is in. These land as `data-n` on
        // the `.staff` / `.layer` / `.measure` groups a note sits inside.
        'staff@n',
        'layer@n',
        'measure@n',
    ],
    // The notated layout is the default: voices *are* a notational fact — layers are what stems
    // and beams show — and the performed layout is the evidence view, one toggle away.
    performanceAlignment: false,
    performanceScale: 16,
    performanceSystemDuration: 10,
    performanceUnmatched: 'plain',
    performanceVelocityOpacity: false,
    performanceRuler: false,
};

/**
 * The WebAssembly module is several megabytes, so it is instantiated once and shared; a toolkit on
 * top of it is cheap and is what callers hold on to.
 */
let modulePromise: ReturnType<typeof createVerovioModule> | undefined;

export async function loadVerovio(): Promise<VerovioToolkit> {
    modulePromise ??= createVerovioModule();
    return new VerovioToolkit(await modulePromise);
}

/**
 * Whether the loaded toolkit knows an option at all.
 *
 * The vendored build can be older than the fork — `performanceBreaks` arrived in `a1746b1a9`, and
 * a build from `7e8d5cea3` answers `Unsupported option` in the log rather than throwing. A control
 * for an option the build does not have would silently do nothing, so it asks first.
 */
export function supportsOption(toolkit: VerovioToolkit, name: string): boolean {
    const available = toolkit.getAvailableOptions() as unknown as {
        groups?: Record<string, { options?: Record<string, unknown> }>;
    };
    return Object.values(available.groups ?? {}).some((group) => name in (group.options ?? {}));
}

/** Render the score: one SVG per page, in the order they are laid out. */
export function renderScore(
    toolkit: VerovioToolkit,
    mei: string,
    options?: Partial<ScoreOptions>,
): string[] {
    // `setOptions` only adds to what the toolkit already holds, so an option a previous render set
    // would otherwise linger into this one.
    toolkit.resetOptions();
    toolkit.setOptions({ ...defaultOptions, ...options });
    if (!toolkit.loadData(mei)) {
        throw new Error('Verovio could not read the MEI');
    }

    const pages: string[] = [];
    for (let page = 1; page <= toolkit.getPageCount(); page++) {
        pages.push(toolkit.renderToSVG(page));
    }
    return pages;
}

/** The distance between two staff lines, in the units the SVG is drawn in. */
export function staffSpace(options?: Partial<ScoreOptions>): number {
    const { unit = 9 } = { ...defaultOptions, ...options };
    return unit * 20;
}
