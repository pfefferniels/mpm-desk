import { v4 } from "uuid";
import { NoteSpan, SoftSpan, SustainSpan } from "../performance/midiSpans";
import { ScoreEvent } from "./scoreEvents";

export const insertPedals = (
    pedals: (SustainSpan | SoftSpan)[],
    pairs: [ScoreEvent, NoteSpan][],
    mei: Document,
    source: string
) => {
    let recording = mei.querySelector('recording[source="' + source + '"]');
    if (!recording) {
        console.log('no performance element found, creating one');
        recording = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'recording');
        const performance = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'performance');

        const music = mei.querySelector('music');
        if (!music) {
            console.log('No <music> element found. Aborting.');
            return;
        }

        music.appendChild(performance);
        performance.appendChild(recording);
    }

    let prevEndTstamp = 0
    for (const pedal of pedals) {
        let bestEndIndex = 0
        let pedalElementId: string | undefined = undefined
        if (pairs.length > 0) {
            let bestStart = Infinity
            let bestStartIndex = 0
            pairs
                .forEach((pair, i) => {
                    const diff = Math.abs(pair[1].onsetMs - pedal.onsetMs)
                    if (diff < bestStart /*&& pair[1].onsetMs > pedal.onsetMs*/) {
                        bestStart = diff
                        bestStartIndex = i
                    }
                })

            let bestEnd = Infinity

            pairs
                .forEach((pair, i) => {
                    const diff = Math.abs(pair[1].offsetMs - pedal.offsetMs)
                    if (diff < bestEnd
                        && pairs[bestStartIndex][0].tstamp <= pair[0].tstamp) {
                        bestEnd = diff
                        bestEndIndex = i
                    }
                })

            const pedalEl = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'pedal')

            const startPair = pairs[bestStartIndex][0]
            const endPair = pairs[bestEndIndex][0]

            const startid = startPair.id
            const endid = endPair.id

            pedalEl.setAttribute('startid', startid)
            if (startPair.tstamp !== endPair.tstamp) pedalEl.setAttribute('endid', endid)
            pedalEl.setAttribute('func', pedal.type)
            pedalEl.setAttribute('place', 'below')
            pedalEl.setAttribute('staff', '2')

            if (pedal.type === 'sustain') {
                if (prevEndTstamp === pairs[bestStartIndex][0].tstamp) {
                    pedalEl.setAttribute('dir', 'bounce')
                    pedalEl.setAttribute('form', 'altpedstar')
                }
                else {
                    pedalEl.setAttribute('dir', 'down')
                    pedalEl.setAttribute('form', 'pedstar')
                }
            }
            else {
                pedalEl.setAttribute('type', 'soft')
            }

            pedalElementId = v4()
            pedalEl.setAttribute('xml:id', pedalElementId)

            const startEl = Array.from(mei.querySelectorAll('note')).find(el => el.getAttribute('xml:id') === startid)
            if (!startEl) {
                console.log('start element could not be found', startid)
                continue
            }

            const measure = startEl.closest('measure')
            if (!measure) {
                console.log('element', startEl, 'is not enclosed in a measure')
                continue
            }

            measure.appendChild(pedalEl)
        }

        const when = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'when');
        recording.appendChild(when);

        when.setAttribute('absolute', pedal.onsetMs.toFixed(0) + 'ms');
        when.setAttribute('abstype', 'smil');
        when.setAttribute('corresp', pedal.link || pedal.id);
        if (pedalElementId) when.setAttribute('data', `#${pedalElementId}`);
        when.setAttribute('type', pedal.type);

        const durationMs = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'extData');
        durationMs.setAttribute('type', 'duration');
        durationMs.textContent = (pedal.offsetMs - pedal.onsetMs).toFixed(0) + 'ms';

        const onsetTicks = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'extData');
        onsetTicks.setAttribute('type', 'onsetTicks');
        onsetTicks.textContent = pedal.onset.toString();

        const durationTicks = mei.createElementNS('http://www.music-encoding.org/ns/mei', 'extData');
        durationTicks.setAttribute('type', 'durationTicks');
        durationTicks.textContent = (pedal.offset - pedal.onset).toString();

        when.appendChild(durationMs);
        when.appendChild(onsetTicks);
        when.appendChild(durationTicks);

        if (bestEndIndex !== 0) prevEndTstamp = pairs[bestEndIndex][0].tstamp
    }
}
