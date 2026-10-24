// Mutable Instruments Elements in Faust (faust-rs), polyphonic, at 32 kHz.
// Voices: freq/gain/gate, gain (the velocity) driving the strength input; each
// voice gives its raw, center and side. The effect is what Part does after its
// voices: the stereo mix of the space control, the soft limit and the reverb.
declare name "elements_poly";
declare options "[midi:on][nvoices:4]";
el = library("elements.lib");

freq = hslider("freq", 220, 8, 12000, 0.001);
gain = hslider("gain", 0.5, 0, 1, 0.001);
gate = button("gate");

process = el.voice(el.note2f(el.freq2note(freq) + el.modulation), gain, gate, el.model, 0.0, 0.0);
effect = el.body;
