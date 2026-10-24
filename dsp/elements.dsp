// Mutable Instruments Elements in Faust (faust-rs): the module, at 32 kHz.
// Inputs: blow, strike (the module's audio inputs). Outputs: main, aux.
declare name "elements";
el = library("elements.lib");
process = el.module;
