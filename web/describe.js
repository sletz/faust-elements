// What a patch sounds like: one note rendered offline with the page's wasm DSPs
// and measured. Shared by the atlas (scripts/gen_atlas.mjs, under node) and the
// page (measure-worker.js), so that a sound measured in the page lands where the
// atlas would put it.
//
// The note is played as the page plays it: one voice into the body at 32 kHz,
// held then released, with the page's divergence guard.
//
// Descriptors, on the stereo output while the note is held unless stated:
//   brightness   spectral centroid, Hz
//   noisiness    spectral flatness, dB: 0 for white noise, about -75 for a pure
//                tone (bins more than 100 dB below the strongest count at that
//                level, so that the floor is stated rather than numerical)
//   harmonicity  share of the energy within a tenth of the fundamental of its
//                harmonics: about 0.2 for a flat spectrum, 1 for a harmonic sound
//   attack       time to reach 90 % of the loudest 10 ms frame, s (at least 10 ms)
//   sustain      level of the last 200 ms of the hold against the loudest frame, dB
//   decay        time from the loudest frame down 30 dB, s; when the render ends
//                first, extrapolated from the slope of its last 500 ms (dB against
//                time, least squares) and `censored`; at most 30 s (MAX_DECAY)
//   loudness     loudest 10 ms frame, dBFS
//   width        side against mid energy (L - R against L + R), dB
//
// Exports: SR, NOTE and AXES (the note and the descriptors, written into atlas.json by
// scripts/gen_atlas.mjs), LOG_AXES, render (a patch to a stereo render), describe (a
// render to its descriptors) and project (descriptors to the atlas's principal
// components, for the page). The module touches no DOM: it runs under node, in a Worker
// and in the page.
import { FaustWasmDsp } from "./faust-wasm-dsp.js";

// The model's sample rate, Hz: every render is made at the module's rate.
export const SR = 32000;
// Frames per compute call: the AudioWorklet's render quantum, a multiple of the model's
// 16-frame block, so that the gate changes on a block boundary, as in the page.
const QUANTUM = 128;
// The note every sound is measured with: MIDI key 57 (A3, `frequency` 220 Hz), `velocity`
// 0.7 (the voice's gain, in [0, 1]), the gate held `hold` s of a render of `total` s.
export const NOTE = { key: 57, frequency: 220, velocity: 0.7, hold: 1, total: 2 };
// The descriptors, in the order of atlas.json's `axes` and of each point's `d`.
export const AXES = ["brightness", "noisiness", "harmonicity", "attack", "sustain", "decay", "loudness", "width"];
// Measures read on a log scale.
export const LOG_AXES = new Set(["brightness", "attack", "decay"]);
// The page's divergence guard (elements-processor.js): a voice output beyond it, or not
// finite, ends the render (null), where the page would clear the voice and go on.
const VOICE_GUARD = 1e3;
// Below this level of the loudest frame (dBFS), a sound is too quiet to be described.
const SILENT_DB = -60;
// The note's controls: set by NOTE, never by a patch.
const FIXED = new Set(["freq", "gain", "gate"]);
// The longest decay reported, s.
const MAX_DECAY = 30;

/**
 * Renders NOTE with a patch, as the page plays it with one voice: the voice's three
 * outputs (raw, center, side) feed the body's three inputs, QUANTUM frames at a time, and
 * the gate falls after NOTE.hold seconds. Fresh DSP instances are made on every call, so
 * that no state carries over from one render to the next.
 * @param {{json: Object, module: WebAssembly.Module}} voiceCode - the voice
 *   (web/dsp/voice.*), compiled
 * @param {{json: Object, module: WebAssembly.Module}} bodyCode - the body (mix, limiter,
 *   reverb: web/dsp/body.*), compiled
 * @param {Object<string, number>} patch - control values by key (freq, gain and
 *   gate are the note's)
 * @returns {{left: Float64Array, right: Float64Array}|null} the stereo output (aux on the
 *   left, main on the right, as the page plays them), NOTE.total seconds at SR,
 *   or null when the voice diverged
 */
export function render(voiceCode, bodyCode, patch) {
  const hold = NOTE.hold * SR;
  const total = NOTE.total * SR;
  const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
  const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
  // Every control of the patch goes to both DSPs, as the worklet sends every control to
  // every DSP; a key a DSP does not have is ignored.
  for (const [k, v] of Object.entries(patch)) {
    if (FIXED.has(k)) continue;
    voice.set(k, v);
    body.set(k, v);
  }
  voice.set("freq", NOTE.frequency);
  voice.set("gain", NOTE.velocity);
  voice.set("gate", 1);
  const left = new Float64Array(total);
  const right = new Float64Array(total);
  for (let t = 0; t < total; t += QUANTUM) {
    if (t === hold) voice.set("gate", 0);
    voice.compute(QUANTUM);
    for (let c = 0; c < 3; c += 1) {
      const o = voice.output(c);
      // The guard: `!(x <= guard)` is true for NaN as well.
      for (let i = 0; i < QUANTUM; i += 1) if (!(Math.abs(o[i]) <= VOICE_GUARD)) return null;
      body.input(c).set(o);
    }
    body.compute(QUANTUM);
    const main = body.output(0);
    const aux = body.output(1);
    for (let i = 0; i < QUANTUM; i += 1) {
      // aux on the left, main on the right, as the page plays them.
      left[t + i] = aux[i];
      right[t + i] = main[i];
    }
  }
  return { left, right };
}

/**
 * In-place radix-2 FFT of re, im (length a power of two): iterative Cooley-Tukey,
 * decimation in time, forward (exp(-2 pi i k n / N)), not normalized.
 * @param {Float64Array} re - the real parts, replaced by those of the transform
 * @param {Float64Array} im - the imaginary parts, replaced likewise
 */
function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation: j is i with its bits reversed, advanced by a reversed
  // increment (carry from the top bit down); each pair is swapped once (i < j).
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterflies over blocks of `len`, doubling: (cr, ci) is the twiddle factor
  // exp(-2i pi k/len), advanced by one complex multiplication by (wr, wi) per k.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// The analysis frame: N samples (64 ms at 32 kHz) under a Hann window, bins of BIN Hz
// (15.6 Hz).
const N = 2048;
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const BIN = SR / N;
// A power (a mean square, not an amplitude) in dB, floored at -300 dB.
const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));

/**
 * The descriptors of a render, as defined at the top of this file. The envelope is
 * measured on the mid signal in 10 ms frames, the spectrum on the hold, from 50 ms on.
 * @param {{left: Float64Array, right: Float64Array}} out - from render
 * @returns {{d: Object<string, number>, censored: boolean}|null} the descriptors
 *   by name, and whether the decay outlasted the render; null when nearly silent
 */
export function describe({ left, right }) {
  const hold = NOTE.hold * SR;
  const total = NOTE.total * SR;
  const f0 = NOTE.frequency;
  // 10 ms RMS envelope of the mid signal, kept as mean squares (powers): `hop` is 320
  // samples, and db() of a frame is its level.
  const hop = SR / 100;
  const env = [];
  for (let t = 0; t + hop <= total; t += hop) {
    let e = 0;
    for (let i = t; i < t + hop; i += 1) {
      const m = 0.5 * (left[i] + right[i]);
      e += m * m;
    }
    env.push(e / hop);
  }
  // The loudest frame gives the loudness; a sound below SILENT_DB is not described.
  let peakFrame = 0;
  for (let k = 0; k < env.length; k += 1) if (env[k] > env[peakFrame]) peakFrame = k;
  const peak = env[peakFrame];
  const loudness = db(peak);
  if (loudness < SILENT_DB) return null;
  // Attack: the first frame at 90 % of the peak's amplitude (0.81 of its power). Decay:
  // the frames from the peak until the power falls below 1e-3 of it (-30 dB); `censored`
  // when the render ends first.
  let attackFrame = 0;
  while (env[attackFrame] < 0.81 * peak) attackFrame += 1; // 90 % in amplitude
  let decayFrame = peakFrame;
  while (decayFrame < env.length && env[decayFrame] > peak * 1e-3) decayFrame += 1;
  const censored = decayFrame >= env.length;
  let decay = ((decayFrame - peakFrame) * hop) / SR;
  if (censored) {
    // A least-squares line through the level (dB) of the last 50 frames (500 ms) against
    // time (s): its slope (dB/s) and its value at the end of the render. The decay is the
    // time the line needs to fall the dB that remain, at most MAX_DECAY, at least the
    // time from the peak to the end of the render; a level that does not fall gets
    // MAX_DECAY.
    const n = 50;
    let st = 0;
    let sl = 0;
    let stt = 0;
    let stl = 0;
    for (let k = env.length - n; k < env.length; k += 1) {
      const tk = (k * hop) / SR;
      const lk = db(env[k]);
      st += tk;
      sl += lk;
      stt += tk * tk;
      stl += tk * lk;
    }
    const slope = (n * stl - st * sl) / (n * stt - st * st); // dB/s
    const end = (sl - slope * st) / n + slope * ((env.length * hop) / SR);
    const remaining = loudness - 30 - end; // dB still to fall, negative
    decay = slope < 0 ? Math.min(MAX_DECAY, decay + remaining / slope) : MAX_DECAY;
    decay = Math.max(decay, ((env.length - peakFrame) * hop) / SR);
  }
  // Sustain: the mean power of the last 20 frames (200 ms) of the hold over the peak, dB.
  const holdFrames = hold / hop;
  let tail = 0;
  for (let k = holdFrames - 20; k < holdFrames; k += 1) tail += env[k];
  const sustain = db(tail / 20) - loudness;

  // Spectra of the hold, 50 ms to its end, energy-weighted: frames of N samples with 50 %
  // overlap, their power spectra summed, so that a louder frame weighs more.
  const power = new Float64Array(N / 2);
  for (let t = Math.round(0.05 * SR); t + N <= hold; t += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i += 1) re[i] = HANN[i] * 0.5 * (left[t + i] + right[t + i]);
    fft(re, im);
    for (let k = 0; k < N / 2; k += 1) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  // The energies of mid (L + R) and side (L - R) over the hold, for the width.
  let sMid = 0;
  let sSide = 0;
  for (let i = 0; i < hold; i += 1) {
    const m = left[i] + right[i];
    const s = left[i] - right[i];
    sMid += m * m;
    sSide += s * s;
  }
  // The spectral measures start at bin 2 (31 Hz), above DC. Every bin is floored at 100
  // dB below the strongest (1e-10 in power), so that the flatness of a pure tone states
  // that floor rather than numerical noise.
  const lo = 2; // above DC
  let strongest = 0;
  for (let k = lo; k < N / 2; k += 1) strongest = Math.max(strongest, power[k]);
  const floor = Math.max(strongest * 1e-10, 1e-300);
  let total2 = 0;
  let weighted = 0;
  let logSum = 0;
  for (let k = lo; k < N / 2; k += 1) {
    const p = Math.max(power[k], floor);
    total2 += p;
    weighted += p * k * BIN;
    logSum += Math.log(p);
  }
  // Flatness: the geometric mean of the power spectrum over its arithmetic mean (1 for
  // white noise). Harmonicity: the power within a tenth of f0 of every harmonic of f0
  // below Nyquist, over the total.
  const count = N / 2 - lo;
  const flatness = Math.exp(logSum / count) / (total2 / count);
  let harmonic = 0;
  for (let h = 1; h * f0 < SR / 2; h += 1) {
    const f = h * f0;
    const k0 = Math.max(lo, Math.round((f - 0.1 * f0) / BIN));
    const k1 = Math.min(N / 2 - 1, Math.round((f + 0.1 * f0) / BIN));
    for (let k = k0; k <= k1; k += 1) harmonic += Math.max(power[k], floor);
  }
  return {
    // Brightness: the spectral centroid (Hz). The attack is at least one frame (10 ms),
    // the sustain at least -80 dB.
    d: {
      brightness: weighted / total2,
      noisiness: db(flatness),
      harmonicity: Math.min(1, harmonic / total2),
      attack: Math.max(0.01, (attackFrame * hop) / SR),
      sustain: Math.max(-80, sustain),
      decay,
      loudness,
      width: db(sSide) - db(sMid),
    },
    censored,
  };
}

/**
 * A point's coordinates on the atlas's principal components: each descriptor of the
 * projection (all but the loudness) standardized as the atlas was (the natural log of
 * LOG_AXES, floored at 1e-3; minus the atlas's mean, over its standard deviation), then
 * its dot product with each component's loadings. The page places the current sound and
 * the sound the timbre orbit asks for with it.
 * @param {Object} atlas - web/atlas.json (its projection and components)
 * @param {Object<string, number>} d - descriptors by name
 * @returns {number[]} one coordinate per component
 */
export function project(atlas, d) {
  const { axes, mean, sd } = atlas.projection;
  const z = axes.map((a, j) => ((LOG_AXES.has(a) ? Math.log(Math.max(d[a], 1e-3)) : d[a]) - mean[j]) / sd[j]);
  return atlas.components.map((c) => axes.reduce((s, a, j) => s + z[j] * c.loadings[a], 0));
}
