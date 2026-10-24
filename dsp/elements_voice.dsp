// The voice alone (raw, center, side), against elements::Voice.
declare name "elements_voice";
el = library("elements.lib");
process = el.voice(el.note2f(el.note + el.modulation), el.strength, el.gate, el.model);
