/**
 * The performed layout drawn from the matches the model is sure of: see `./anchoredLayout`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { VerovioToolkit } from 'verovio/esm';
import { loadVerovio, renderPerformance } from '../../verovio/toolkit';
import { DOUBTFUL, SURE, anchoredLayout, anchoredOnsets } from './anchoredLayout';

/** Four quarter notes a bar, the sure ones at 600 ms a beat */
const placeOf = new Map([
    ['n1', 0],
    ['n2', 1],
    ['n3', 2],
    ['n4', 3],
    ['n5', 4],
]);
const struckAt = new Map([
    ['p1', 0],
    ['p2', 600],
    ['p3', 1500],
    ['p4', 1800],
    ['p5', 2400],
]);
const match = (n: number, confidence: number) => ({
    scoreId: `n${String(n)}`,
    performanceId: `p${String(n)}`,
    confidence,
});

describe('where a match is drawn', () => {
    it('leaves a match the model is sure of where it was struck', () => {
        const moved = anchoredOnsets([1, 2, 3, 4, 5].map((n) => match(n, 1)), placeOf, struckAt);

        expect(moved.size).toBe(0);
    });

    it('draws a doubtful one where the score puts it between the sure ones', () => {
        // Struck at 1500, but due half way between 600 and 1800
        const moved = anchoredOnsets(
            [match(1, 1), match(2, 1), match(3, 0.2), match(4, 1), match(5, 1)],
            placeOf,
            struckAt,
        );

        expect(moved.get('n3')).toEqual({ struck: 1500, drawn: 1200 });
        expect([...moved.keys()]).toEqual(['n3']);
    });

    it('draws one in between in proportion to how sure the model was', () => {
        const halfway = (SURE + DOUBTFUL) / 2;
        const moved = anchoredOnsets(
            [match(1, 1), match(2, 1), match(3, halfway), match(4, 1), match(5, 1)],
            placeOf,
            struckAt,
        );

        expect(moved.get('n3')?.drawn).toBeCloseTo(1350);
    });

    it('reads the place a doubtful match is due at off the sure ones only', () => {
        // n2 is doubtful as well, and struck late: n3 is read between n1 and n4, not off n2
        const late = new Map([...struckAt, ['p2', 900]]);
        const moved = anchoredOnsets(
            [match(1, 1), match(2, 0), match(3, 0), match(4, 1), match(5, 1)],
            placeOf,
            late,
        );

        expect(moved.get('n2')?.drawn).toBeCloseTo(600);
        expect(moved.get('n3')?.drawn).toBeCloseTo(1200);
    });

    it('draws a doubtful note of a chord at the middle of the moments the chord was struck at', () => {
        const chord = new Map([...placeOf, ['c1', 2], ['c2', 2], ['c3', 2]]);
        const struck = new Map([...struckAt, ['q1', 1100], ['q2', 1200], ['q3', 1700]]);
        const moved = anchoredOnsets(
            [
                match(1, 1),
                match(5, 1),
                { scoreId: 'c1', performanceId: 'q1', confidence: 1 },
                { scoreId: 'c2', performanceId: 'q2', confidence: 1 },
                { scoreId: 'c3', performanceId: 'q3', confidence: 0 },
            ],
            chord,
            struck,
        );

        // The sure two of the chord stay where they were struck; the doubtful one joins them
        expect(moved.get('c3')?.drawn).toBeCloseTo(1150);
        expect(moved.has('c1')).toBe(false);
    });

    it('leaves a doubtful match beyond the sure ones where it was struck', () => {
        const moved = anchoredOnsets(
            [match(1, 0), match(2, 1), match(3, 1), match(4, 1), match(5, 0)],
            placeOf,
            struckAt,
        );

        expect(moved.size).toBe(0);
    });

    it('does not let a sure match that runs back in time draw anything backwards', () => {
        // n3 is sure, and struck before n2
        const backwards = new Map([...struckAt, ['p3', 500], ['p4', 2000]]);
        const moved = anchoredOnsets(
            [match(1, 1), match(2, 1), match(3, 1), match(4, 0), match(5, 1)],
            placeOf,
            backwards,
        );

        // Read between n2 at 600 and n5 at 2400, n3 being dropped as an anchor; read off n3 it
        // would have been 1450
        expect(moved.get('n4')?.drawn).toBeCloseTo(1800);
    });
});

const when = (id: string, ms: number) =>
    `<when absolute="${String(ms)}ms" abstype="smil" data="#${id}"><extData type="velocity">64</extData><extData type="duration">300ms</extData></when>`;

const scoreMei = (whens: string, other = '') => `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead><fileDesc><titleStmt><title/></titleStmt><pubStmt/></fileDesc></meiHead>
  <music>
    <performance><recording source="take">${whens}</recording>${other}</performance>
    <body><mdiv><score>
      <scoreDef meter.count="4" meter.unit="4"><staffGrp>
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>
      </staffGrp></scoreDef>
      <section>
        <measure n="1"><staff n="1"><layer n="1">
          <note xml:id="n1" pname="c" oct="5" dur="4"/><note xml:id="g1" pname="e" oct="5" grace="unacc" dur="8"/><note xml:id="n2" pname="d" oct="5" dur="4"/><note xml:id="n3" pname="e" oct="5" dur="4"/><note xml:id="n4" pname="f" oct="5" dur="4"/>
        </layer></staff></measure>
        <measure n="2"><staff n="1"><layer n="1">
          <note xml:id="n5" pname="g" oct="5" dur="4"/><note xml:id="n6" pname="a" oct="5" dur="4"/><note xml:id="n7" pname="b" oct="5" dur="4"/><note xml:id="n8" pname="c" oct="6" dur="4"/>
        </layer></staff></measure>
      </section>
    </score></mdiv></body>
  </music>
</mei>`;

const absoluteOf = (mei: string, source: string, id: string) =>
    [...new DOMParser().parseFromString(mei, 'application/xml').getElementsByTagName('recording')]
        .find((recording) => recording.getAttribute('source') === source)
        ?.querySelector(`when[data="#${id}"]`)
        ?.getAttribute('absolute');

describe('the document the page is laid out from', () => {
    it('moves the match, and leaves what else points at its note alone', () => {
        // The second <when> on n2 is something played on it, not the match
        const mei = scoreMei(`${when('n1', 0)}${when('n2', 900)}${when('n2', 950)}${when('n3', 1200)}`);
        const laidOut = anchoredLayout(mei, 'take', new Map([['n2', { struck: 900, drawn: 600 }]]));

        const whens = [...new DOMParser().parseFromString(laidOut, 'application/xml').getElementsByTagName('when')];
        expect(whens.map((element) => element.getAttribute('absolute'))).toEqual([
            '0ms',
            '600ms',
            '950ms',
            '1200ms',
        ]);
    });

    it('leaves a grace note where it was struck', () => {
        const mei = scoreMei(`${when('n1', 0)}${when('g1', 450)}${when('n2', 600)}`);
        const laidOut = anchoredLayout(mei, 'take', new Map([['g1', { struck: 450, drawn: 600 }]]));

        expect(absoluteOf(laidOut, 'take', 'g1')).toBe('450ms');
    });

    it('lays out only the take under review', () => {
        const mei = scoreMei(when('n2', 900), `<recording source="other">${when('n2', 900)}</recording>`);
        const laidOut = anchoredLayout(mei, 'take', new Map([['n2', { struck: 900, drawn: 600 }]]));

        expect(absoluteOf(laidOut, 'take', 'n2')).toBe('600ms');
        expect(absoluteOf(laidOut, 'other', 'n2')).toBe('900ms');
    });

    it('hands back the very document when nothing moves', () => {
        const mei = scoreMei(when('n1', 0));

        expect(anchoredLayout(mei, 'take', new Map())).toBe(mei);
    });
});

describe('the engraving', () => {
    let toolkit: VerovioToolkit;

    beforeAll(async () => {
        toolkit = await loadVerovio();
    }, 60_000);

    /** Each note's performed onset as the fork lays it out, by id */
    const onsetsOf = (mei: string) => {
        const svg = renderPerformance(toolkit, mei, {
            performanceRecording: 'take',
            performanceSystemDuration: 0,
        }).join('');
        return new Map(
            [...svg.matchAll(/<g[^>]*data-class="note"[^>]*>/g)].flatMap(([tag]) => {
                const id = /data-id="([^"]+)"/.exec(tag)?.[1];
                const onset = /data-perf-onset="([^"]+)"/.exec(tag)?.[1];
                return id && onset ? [[id, Number(onset)] as const] : [];
            }),
        );
    };

    it('draws a moved match at the moment it is moved to, and the unmatched notes after it', () => {
        // n3 doubtful and struck late; n6 and n7 matched to nothing
        const struck = new Map([
            ['n1', 0],
            ['n2', 600],
            ['n3', 1500],
            ['n4', 1800],
            ['n5', 2400],
            ['n8', 4200],
        ]);
        const mei = scoreMei([...struck].map(([id, ms]) => when(id, ms)).join(''));
        const moved = anchoredOnsets(
            [...struck.keys()].map((id) => ({
                scoreId: id,
                performanceId: id,
                confidence: id === 'n3' ? 0 : 1,
            })),
            new Map([
                ['n1', 0],
                ['n2', 1],
                ['n3', 2],
                ['n4', 3],
                ['n5', 4],
                ['n8', 7],
            ]),
            struck,
        );

        const onsets = onsetsOf(anchoredLayout(mei, 'take', moved));

        expect(onsets.get('n3')).toBe(1200);
        expect(onsets.get('n4')).toBe(1800);
        // The fork places a note with no <when> by where it stands between the timed notes
        expect(onsets.get('n6')).toBe(3000);
        expect(onsets.get('n7')).toBe(3600);
    });
});
