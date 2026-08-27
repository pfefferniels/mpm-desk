/**
 * A client point in an SVG's own user coordinates.
 *
 * Every desk that turns a mouse gesture into a date needs this, and before it lived here each
 * one carried its own copy — four of them inside the dynamics desk alone. The copies had already
 * drifted: some fell back to `{ x: 0, y: 0 }` when there was no CTM, some to the raw client
 * point, which is a different wrong answer.
 *
 * `null` when the element is not rendered — no screen CTM — so a caller has to say what it wants
 * to do about that rather than be handed a plausible origin.
 */
export const svgPoint = (
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
): { x: number; y: number } | null => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
};

/**
 * How many user units one screen pixel is worth, horizontally.
 *
 * The snap thresholds are stated in screen pixels — twenty of them is a comfortable grab — and
 * have to be converted before they can be compared against a distance in ticks. `ctm.a` is the
 * horizontal scale, and a desk zoomed in far enough that it is zero would divide by it.
 */
export const svgUnitsPerPixel = (svg: SVGSVGElement, fallback = 1.5): number => {
    const ctm = svg.getScreenCTM();
    if (!ctm || ctm.a === 0) return fallback;
    return 1 / ctm.a;
};
