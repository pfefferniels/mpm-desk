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
    /** The velocity rendered faintest, or -1 to take it from the recording */
    performanceVelocityMin?: number;
    /** The velocity rendered fully opaque, or -1 to take it from the recording */
    performanceVelocityMax?: number;
    /** Draw a ruler of the performed time below each system */
    performanceRuler?: boolean;
    /** The spacing of the ruler ticks, in seconds */
    performanceRulerInterval?: number;
}

export type ScoreOptions = VerovioOptions & PerformanceOptions;

/**
 * The MEI units given to one second of performed time.
 *
 * Every view that offers a zoom starts here, so that a score opens at the same size wherever it
 * is drawn and a slider only ever moves away from one known default.
 */
export const DEFAULT_PERFORMANCE_SCALE = 16;

/**
 * How a score is drawn unless a desk asks for something else: the notated layout, with nothing of
 * the performance painted onto it.
 *
 * The fork's own defaults are the other way round, and two of them paint the note's own `<g>` —
 * `performanceVelocityOpacity` writes `opacity` and `performanceUnmatched: 'mark'` writes
 * `fill="darkred"`, which is the element a desk colouring by part writes on. They are off here and
 * come back through {@link performedOptions}, so a desk that means the performed layout gets them
 * and one that does not is left an unpainted engraving to draw on.
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
        // And what it sounds: the four the alignment desk's overlays read back off the drawing to
        // place a cross at the right pitch. `readPerformedNote` wants all four, because an
        // accidental may be notated (`@accid`) or implied by the key (`@accid.ges`).
        'note@pname',
        'note@oct',
        'note@accid',
        'note@accid.ges',
    ],
    // Which reading of an `<app>` is engraved. The alignment desk writes what a performer did
    // differently as `<rdg source="performance">` beside the notated one, and this is a statement
    // about the whole application rather than about one desk: mpm-desk shows a score as it was
    // played wherever it shows one at all.
    appXPathQuery: ['./rdg[contains(@source, "performance")]'],
    performanceAlignment: false,
    performanceScale: DEFAULT_PERFORMANCE_SCALE,
    performanceSystemDuration: 10,
    performanceUnmatched: 'plain',
    performanceVelocityOpacity: false,
    performanceRuler: false,
};

/**
 * The overrides that lay a score out along a recording rather than along notated durations.
 *
 * A named set rather than an object literal at each call site, because everything drawn *into*
 * such a layout is measured in `unitsPerSecond(options)` — so a caller rendering at one
 * `performanceScale` and measuring at another gets marks in the wrong place, and a test doing the
 * same fails for a reason that has nothing to do with what it is checking.
 *
 * `adjustPageWidth` and the two margins are what keep the page around the music: a system holding
 * a whole performance runs a long way past the default width, and the ruler is drawn below music
 * that does not know about it.
 */
export const performedOptions: Partial<ScoreOptions> = {
    performanceAlignment: true,
    adjustPageWidth: true,
    pageMarginBottom: 150,
    pageMarginRight: 100,
    performanceUnmatched: 'mark',
    performanceVelocityOpacity: true,
    performanceRuler: true,
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

/**
 * Render the *performance*: the same engraving, laid out along the time a `<recording>` was
 * played in rather than along the notated durations.
 *
 * The one line of difference from {@link renderScore} is {@link performedOptions}, and it is
 * worth a name of its own: the two layouts are the two things this fork can draw, and a caller
 * that means one of them should not have to remember which seven options say so.
 */
export function renderPerformance(
    toolkit: VerovioToolkit,
    mei: string,
    options?: Partial<ScoreOptions>,
): string[] {
    return renderScore(toolkit, mei, { ...performedOptions, ...options });
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

/**
 * How many MEI units one second of performed time covers — the scale of the horizontal axis
 * everything drawn into a performed layout has to follow.
 *
 * verovio spaces the staff at `unit` MEI units, which are ten of the units the SVG is drawn in.
 */
export function unitsPerSecond(options?: Partial<ScoreOptions>): number {
    const { performanceScale = DEFAULT_PERFORMANCE_SCALE, unit = 9 } = {
        ...defaultOptions,
        ...options,
    };
    return performanceScale * unit * 10;
}

/**
 * The same axis in pixels, once the page has been scaled down for the SVG. Anything drawn
 * *beside* the score rather than into it — a piano roll of the recording — has to follow it too.
 */
export function pixelsPerSecond(options?: Partial<ScoreOptions>): number {
    const { scale = 100 } = { ...defaultOptions, ...options };
    return (unitsPerSecond(options) * scale) / 1000;
}

/** The distance between two staff lines, in the units the SVG is drawn in. */
export function staffSpace(options?: Partial<ScoreOptions>): number {
    const { unit = 9 } = { ...defaultOptions, ...options };
    return unit * 20;
}
