import type { Voice } from '../../fitting/voices';

/**
 * How a voice is named on screen: `S1/V2`.
 *
 * MEI calls it a `<layer>` and the model that reads it keeps that word, because that is what the
 * encoding says. On screen it is a voice: "layer" is Finale's and MEI's term rather than a
 * reader's, while MusicXML, Sibelius, MuseScore and Dorico all say voice. The panel calls the
 * assembled things parts, so part and voice pair here as they do in MusicXML.
 */
export const voiceLabel = (voice: Voice): string => `S${voice.staff}/V${voice.layer}`;
