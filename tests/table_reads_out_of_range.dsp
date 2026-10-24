// The functions of elements.lib that read a table at an index computed from a
// control, called with arguments outside the range the controls give them, as a
// host writing past the sliders' bounds would: each must read within its table
// and sound as the nearest bound (tests/table_reads_bounds.dsp). make check
// compares the two, sample for sample. The arguments are sliders, read at run
// time: literal ones would be folded by the compiler.
import("stdfaust.lib");
el = library("elements.lib");
imp = 1.0 - 1.0';
w = (*(1664525) : +(1013904223)) ~ _;
// s2r: semitones beyond -128 .. 128 (lut_pitch_ratio_high/low).
s2r = el.s2r(hslider("st_low", -300, -1000, 1000, 0.001)), el.s2r(hslider("st_high", 500, -1000, 1000, 0.001));
// The exciter's pulse amplitude and low-pass: a timbre beyond 0 .. 1 (lut_approx_svf_*).
timbre = el._pulse(hslider("t_low", -1, -1000, 1000, 0.001)), el._pulse(hslider("t_high", 5, -1000, 1000, 0.001)),
    (imp : el._exc_lp(hslider("lp_low", -1, -1000, 1000, 0.001))), (imp : el._exc_lp(hslider("lp_high", 5, -1000, 1000, 0.001)));
// The strike's sample player: a meta parameter beyond 0 .. 1 (smp_boundaries).
strike(param) = el._strike_block(1, 1, 1, param, 0.5, 0.0, w, 0.0, 0.0, 0.0, 0.0, 0, 0) : par(i, 16, _), si.block(8);
// The accent: a velocity above 1 (lut_accent_gain_coarse/fine).
accent = el.voice(el.note2f(57.0), hslider("velocity", 1.5, -1000, 1000, 0.001), 1, 0, 0.0, 0.0);
process = s2r, timbre, strike(hslider("p_low", -1, -1000, 1000, 0.001)), strike(hslider("p_high", 2, -1000, 1000, 0.001)), accent;
