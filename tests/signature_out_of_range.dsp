// The blow exciter's granular player with a signature outside its range, as a
// host that writes past the slider's bounds would give it: it must read the
// noise sample within the table and sound as the nearest bound
// (tests/signature_bounds.dsp). make check compares the two, sample for sample.
el = library("elements.lib");
w = (*(1664525) : +(1013904223)) ~ _;
process = el.blow_granular(w, 0.5, 0.5, -1.0), el.blow_granular(w, 0.5, 0.5, 5.0);
