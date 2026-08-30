import { MidiFile } from "midifile-ts";

interface RecordingMetadata {
    applicationName?: string;
    source?: string;
    parameters: string[];
}

export const parseMetadata = (midi: MidiFile) => {
    const metadata: RecordingMetadata = {
        parameters: []
    };

    for (const track of midi.tracks) {
        for (let i = 0; i < track.length; i++) {
            const event = track[i];

            if (event.type === 'meta' && event.subtype === 'text') {
                if (i === 0) {
                    metadata.applicationName = event.text;
                }
                else if (i === 1) {
                    metadata.source = event.text;
                }
                else {
                    metadata.parameters.push(event.text);
                }
            }
            else break;
        }
    }

    return metadata;
}

export const insertMetadata = (metadata: RecordingMetadata, meiDoc: Document) => {
    let manifestationList = meiDoc.querySelector("manifestationList")
    if (!manifestationList) {
        manifestationList = meiDoc.createElementNS("http://www.music-encoding.org/ns/mei", "manifestationList");
        const meiHeader = meiDoc.querySelector("meiHead");
        if (!meiHeader) {
            console.warn("No <meiHead> found in MEI document");
            return;
        }
        meiHeader.appendChild(manifestationList);
    }

    let manifestation = manifestationList.querySelector(`manifestation[*|id="${metadata.source || 'unknown-source'}"]`);
    if (!manifestation) {
        manifestation = meiDoc.createElementNS("http://www.music-encoding.org/ns/mei", "manifestation");
        manifestation.setAttribute("xml:id", metadata.source || 'unknown-source');
        manifestationList.appendChild(manifestation);
    }

    let captureMode = manifestation.querySelector("physDesc captureMode");
    if (!captureMode) {
        const physDesc = meiDoc.createElementNS("http://www.music-encoding.org/ns/mei", "physDesc");
        manifestation.appendChild(physDesc);
        captureMode = meiDoc.createElementNS("http://www.music-encoding.org/ns/mei", "captureMode");
        physDesc.appendChild(captureMode);
    }

    const list = meiDoc.createElementNS("http://www.music-encoding.org/ns/mei", "list");
    for (const param of metadata.parameters) {
        const li = meiDoc.createElementNS("http://www.music-encoding.org/ns/mei", "li");
        li.textContent = param;
        list.appendChild(li);
    }

    const p = meiDoc.createElementNS("http://www.music-encoding.org/ns/mei", "p");
    p.appendChild(meiDoc.createTextNode(metadata.applicationName || 'unknown application'))
    p.appendChild(meiDoc.createTextNode("Parameters:"));
    p.appendChild(list);

    captureMode.appendChild(p);
}
