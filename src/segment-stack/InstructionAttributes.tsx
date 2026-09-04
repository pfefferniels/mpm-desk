/**
 * An instruction, in its own words — but only the words about the sound.
 *
 * The drawings above say what a gesture does; this says what it is made of. Everything the
 * drawing had to interpret — `@curvature`, `@protraction`, a `@transition.to` that never
 * takes effect — is here as the document writes it, so a reader who distrusts the picture
 * can check it without leaving the card.
 *
 * **Condensed, not quoted.** A `<tempo>` here carries nine attributes, four of them
 * bookkeeping: an `xml:id`, a `@date` and an `@endDate` the row already draws, and a
 * `@corresp` pointing back at the segment you are looking at. Printing them buries `@bpm` in a
 * wall of hex. {@link CLERICAL} is what gets dropped, a denylist rather than a per-type
 * allowlist so that an unfamiliar attribute shows up rather than going missing.
 *
 * Long decimals are rounded for display — see {@link condense}.
 *
 * A `@name.ref` — or a `@bpm` / `@volume` that names a style rather than a number — is a
 * pointer, and a pointer on its own says nothing. The `<…Def>` it resolves to is shown
 * underneath it, resolved through the `<style>` in force at the instruction's own date.
 */
import { useMemo } from "react";
import type { PerformanceReader } from "../utils/mpm";

const NAME = "#111827";
const ATTRIBUTE = "#6b7280";
const VALUE = "#2563eb";
const PUNCTUATION = "#9ca3af";

/**
 * Attributes that say where an instruction is filed, not what it does.
 *
 * `@date` and `@endDate` are on the list because the row draws them: the gesture's place in
 * the segment is the one thing the picture is *better* at saying. `@noteid` is a list of
 * opaque score ids, which is a different question ("on which notes?") than this pane
 * answers and would fill it on its own.
 */
const CLERICAL = new Set([
    "xml:id",
    "id",
    "date",
    "endDate",
    "corresp",
    "noteid",
    "xml:base",
    // Not an attribute anyone wrote: espressivo's serializer re-declares the MPM namespace on
    // whatever element it is handed, so quoting one standalone puts a URL in front of the first
    // thing it actually says.
    "xmlns",
]);

/** How many decimals a value is worth reading to. */
const DECIMALS = 3;

/**
 * `0.6680369944399959` is a float, not a measurement.
 *
 * Every number in these documents is the output of a fit, so its last dozen digits are an
 * artefact of binary arithmetic rather than something anyone chose. Three decimals is finer
 * than any of these parameters is audible to — `@protraction` and `@curvature` live in
 * −1..1, `@bpm` in the tens — and it is what makes a line of attributes readable at a
 * glance. Anything that is not a number is left exactly alone.
 */
function condense(value: string): string {
    const number = Number(value);
    if (value.trim() === "" || !Number.isFinite(number)) return value;
    const rounded = Number(number.toFixed(DECIMALS));
    return String(rounded);
}

interface Quoted {
    name: string;
    attributes: { name: string; value: string }[];
    /** How deep inside a `<…Def>` this element sits, for the indent. */
    depth: number;
}

const TAG_SHAPE = /^<\/?([\w:.-]+)([\s\S]*?)\/?>$/;
const ATTRIBUTE_SHAPE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

/**
 * Read a serialized element into the lines this pane shows.
 *
 * espressivo's serializer emits no whitespace between elements — it is held to the byte, so
 * that nothing it writes drifts from the Java reference — which makes a nested def one very
 * long line. These documents are element-only, so recovering the nesting needs no more than
 * a token walk, and closing tags carry nothing once the indent says what they said.
 */
function* read(xml: string): Generator<Quoted> {
    let depth = 0;
    for (const [token] of xml.matchAll(/<[^>]+>/g)) {
        if (token.startsWith("</")) {
            depth = Math.max(0, depth - 1);
            continue;
        }
        const tag = TAG_SHAPE.exec(token);
        if (!tag) continue;

        const attributes = [...tag[2].matchAll(ATTRIBUTE_SHAPE)]
            .filter(([, name]) => !CLERICAL.has(name))
            .map(([, name, value]) => ({ name, value: condense(value) }));

        yield { name: tag[1], attributes, depth };
        if (!token.endsWith("/>")) depth += 1;
    }
}

/** One element on one line: what it is, then what it says. */
const Line = ({ element }: { element: Quoted }) => (
    <div
        style={{
            paddingLeft: element.depth * 10,
            textIndent: -10,
            marginLeft: 10,
            marginTop: 1,
        }}
    >
        <span style={{ color: NAME, fontWeight: 600 }}>{element.name}</span>
        {element.attributes.map((attribute, index) => (
            <span key={attribute.name}>
                <span style={{ color: PUNCTUATION }}>{index === 0 ? " " : ", "}</span>
                <span style={{ color: ATTRIBUTE }}>{attribute.name}</span>
                <span style={{ color: PUNCTUATION }}>=</span>
                <span style={{ color: VALUE }}>"{attribute.value}"</span>
            </span>
        ))}
    </div>
);

interface InstructionAttributesProps {
    /** `xml:id`s of the MPM elements one gesture consists of — a span's `elements`. */
    elements: readonly string[];
    mpm: PerformanceReader;
}

export const InstructionAttributes = ({ elements, mpm }: InstructionAttributesProps) => {
    /** Read once per hover: the serializer walks the element, and defs are shared. */
    const quoted = useMemo(
        () =>
            elements.flatMap(id => {
                const instruction = mpm.byId(id);
                if (!instruction) return [];
                const def = mpm.defFor(instruction);
                return [{
                    id,
                    lines: [...read(instruction.element.toXML())],
                    def: def ? [...read(def.toXML())] : null,
                }];
            }),
        [elements, mpm],
    );

    return (
        <div
            style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 10.5,
                lineHeight: 1.5,
                wordBreak: "break-word",
            }}
        >
            {quoted.map(({ id, lines, def }) => (
                <div key={id}>
                    {lines.map((element, index) => <Line key={index} element={element} />)}
                    {def && (
                        <div
                            style={{
                                marginTop: 2,
                                paddingLeft: 7,
                                borderLeft: "2px solid #e5e7eb",
                            }}
                        >
                            {def.map((element, index) => <Line key={index} element={element} />)}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
