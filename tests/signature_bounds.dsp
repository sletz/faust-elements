// The reference of tests/signature_out_of_range.dsp: the same player at the
// bounds of the signature's range.
el = library("elements.lib");
w = (*(1664525) : +(1013904223)) ~ _;
process = el.blow_granular(w, 0.5, 0.5, 0.0), el.blow_granular(w, 0.5, 0.5, 0.99);
