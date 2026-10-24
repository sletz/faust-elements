// The atlas of the web version: random patches rendered with the page's wasm
// DSPs (web/dsp), described by what they sound like, and laid out on a plane.
//
//   node scripts/gen_atlas.mjs [COUNT] [SEED]     (make web-atlas)
//
// Writes web/atlas.json. Each patch draws every control of the voice and the
// body in its range (the model a whole number, the pitch offset left at 0), as
// the orbit's Random does; the 24 presets are added as landmarks. Each is played
// as the page plays it: A3 (220 Hz) at velocity 0.7, held 1 s then released,
// one voice into the body at 32 kHz, with the page's divergence guard. A patch
// that diverges or stays nearly silent is left out.
//
// Descriptors, on the stereo output while the note is held unless stated:
//   brightness   spectral centroid, Hz
//   noisiness    spectral flatness in dB, about -130 (pure tones) .. 0 (white noise)
//   harmonicity  share of the energy within 22 Hz (a tenth of the fundamental) of
//                the harmonics of 220 Hz: about 0.2 for a flat spectrum, 1 for a
//                harmonic sound
//   attack       time to reach 90 % of the loudest 10 ms frame, s
//   sustain      level of the last 200 ms of the hold against the loudest frame, dB
//   decay        time from the loudest frame down 30 dB, over the whole 2 s, s
//   loudness     loudest 10 ms frame, dBFS
//   width        side against mid energy (L - R against L + R), dB
// The plane is the first two principal components of the standardized
// descriptors but the loudness, which follows the level rather than the timbre
// (brightness, attack and decay on a log scale).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FaustWasmDsp, controlKey, uiItems } from "../web/faust-wasm-dsp.js";
import { PRESETS } from "../web/controls.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 32000;
const QUANTUM = 128;
const COUNT = Number(process.argv[2] || 2000);
let seed = Number(process.argv[3] || 1);
const KEY = 57;
const F0 = 220;
const VELOCITY = 0.7;
const HOLD = SR;
const TOTAL = 2 * SR;
const VOICE_GUARD = 1e3;
const SILENT_DB = -60;
const FIXED = new Set(["freq", "gain", "gate", "performance/modulation"]);

function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

function load(name) {
  const json = JSON.parse(readFileSync(join(ROOT, "web/dsp", name + ".json"), "utf8"));
  const module = new WebAssembly.Module(readFileSync(join(ROOT, "web/dsp", name + ".wasm")));
  return { json, module };
}

const voiceCode = load("voice");
const bodyCode = load("body");
const controls = [];
for (const j of [voiceCode.json, bodyCode.json]) {
  for (const item of uiItems(j.ui)) {
    const key = controlKey(item.address);
    if (item.min === undefined || FIXED.has(key) || controls.some((c) => c.key === key)) continue;
    controls.push({ key, min: Number(item.min), max: Number(item.max), step: Number(item.step), init: Number(item.init) });
  }
}

// Renders a patch; returns the stereo output, or null when the voice diverged.
function render(patch) {
  const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
  const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
  for (const [k, v] of Object.entries(patch)) {
    voice.set(k, v);
    body.set(k, v);
  }
  voice.set("freq", F0);
  voice.set("gain", VELOCITY);
  voice.set("gate", 1);
  const left = new Float64Array(TOTAL);
  const right = new Float64Array(TOTAL);
  for (let t = 0; t < TOTAL; t += QUANTUM) {
    if (t === HOLD) voice.set("gate", 0);
    voice.compute(QUANTUM);
    for (let c = 0; c < 3; c += 1) {
      const o = voice.output(c);
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

// In-place radix-2 FFT of re, im (length a power of two).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
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

const N = 2048;
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const BIN = SR / N;
const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));

function describe({ left, right }) {
  // 10 ms RMS envelope of the mid signal.
  const hop = SR / 100;
  const env = [];
  for (let t = 0; t + hop <= TOTAL; t += hop) {
    let e = 0;
    for (let i = t; i < t + hop; i += 1) {
      const m = 0.5 * (left[i] + right[i]);
      e += m * m;
    }
    env.push(e / hop);
  }
  let peakFrame = 0;
  for (let k = 0; k < env.length; k += 1) if (env[k] > env[peakFrame]) peakFrame = k;
  const peak = env[peakFrame];
  const loudness = db(peak);
  if (loudness < SILENT_DB) return null;
  let attackFrame = 0;
  while (env[attackFrame] < 0.81 * peak) attackFrame += 1; // 90 % in amplitude
  let decayFrame = peakFrame;
  while (decayFrame < env.length && env[decayFrame] > peak * 1e-3) decayFrame += 1;
  const holdFrames = HOLD / hop;
  let tail = 0;
  for (let k = holdFrames - 20; k < holdFrames; k += 1) tail += env[k];
  const sustain = db(tail / 20) - loudness;

  // Spectra of the hold, 50 ms to 1 s, energy-weighted.
  const power = new Float64Array(N / 2);
  let sMid = 0;
  let sSide = 0;
  for (let t = Math.round(0.05 * SR); t + N <= HOLD; t += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i += 1) re[i] = HANN[i] * 0.5 * (left[t + i] + right[t + i]);
    fft(re, im);
    for (let k = 0; k < N / 2; k += 1) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  for (let i = 0; i < HOLD; i += 1) {
    const m = left[i] + right[i];
    const s = left[i] - right[i];
    sMid += m * m;
    sSide += s * s;
  }
  let total = 0;
  let weighted = 0;
  let logSum = 0;
  let harmonic = 0;
  const lo = 2; // above DC
  for (let k = lo; k < N / 2; k += 1) {
    const p = power[k] + 1e-30;
    total += p;
    weighted += p * k * BIN;
    logSum += Math.log(p);
  }
  const count = N / 2 - lo;
  const flatness = Math.exp(logSum / count) / (total / count);
  for (let h = 1; h * F0 < SR / 2; h += 1) {
    const f = h * F0;
    const k0 = Math.max(lo, Math.round((f - 0.1 * F0) / BIN));
    const k1 = Math.min(N / 2 - 1, Math.round((f + 0.1 * F0) / BIN));
    for (let k = k0; k <= k1; k += 1) harmonic += power[k];
  }
  return {
    brightness: weighted / total,
    noisiness: 10 * Math.log10(Math.max(flatness, 1e-30)),
    harmonicity: Math.min(1, harmonic / total),
    attack: Math.max(0.01, (attackFrame * hop) / SR),
    sustain: Math.max(-80, sustain),
    decay: ((decayFrame - peakFrame) * hop) / SR,
    loudness,
    width: db(sSide) - db(sMid),
  };
}

// Principal components of the standardized descriptors (Jacobi rotations).
const AXES = ["brightness", "noisiness", "harmonicity", "attack", "sustain", "decay", "loudness", "width"];
const LOG = new Set(["brightness", "attack", "decay"]);
const PCA_AXES = AXES.filter((a) => a !== "loudness");
function principal(points) {
  const d = PCA_AXES.length;
  const rows = points.map((p) => PCA_AXES.map((a) => (LOG.has(a) ? Math.log(Math.max(p.d[a], 1e-3)) : p.d[a])));
  const mean = PCA_AXES.map((_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length);
  const sd = PCA_AXES.map((_, j) => Math.sqrt(rows.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / rows.length) || 1);
  const z = rows.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  const c = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => z.reduce((s, r) => s + r[i] * r[j], 0) / z.length));
  const v = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep += 1) {
    for (let p = 0; p < d; p += 1) {
      for (let q = p + 1; q < d; q += 1) {
        if (Math.abs(c[p][q]) < 1e-12) continue;
        const theta = 0.5 * Math.atan2(2 * c[p][q], c[q][q] - c[p][p]);
        const cs = Math.cos(theta);
        const sn = Math.sin(theta);
        for (let k = 0; k < d; k += 1) {
          const ckp = c[k][p];
          const ckq = c[k][q];
          c[k][p] = cs * ckp - sn * ckq;
          c[k][q] = sn * ckp + cs * ckq;
        }
        for (let k = 0; k < d; k += 1) {
          const cpk = c[p][k];
          const cqk = c[q][k];
          c[p][k] = cs * cpk - sn * cqk;
          c[q][k] = sn * cpk + cs * cqk;
        }
        for (let k = 0; k < d; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = cs * vkp - sn * vkq;
          v[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  const order = PCA_AXES.map((_, i) => i).sort((a, b) => c[b][b] - c[a][a]);
  const totalVar = order.reduce((s, i) => s + c[i][i], 0);
  const comps = order.slice(0, 2).map((i) => ({
    variance: c[i][i] / totalVar,
    loadings: Object.fromEntries(PCA_AXES.map((a, j) => [a, v[j][i]])),
  }));
  points.forEach((p, n) => {
    p.pc = comps.map((comp) => PCA_AXES.reduce((s, a, j) => s + z[n][j] * comp.loadings[a], 0));
  });
  return comps;
}

const round = (x, k = 4) => Number(x.toPrecision(k));
const points = [];
let diverged = 0;
let silent = 0;
const sources = [
  ...PRESETS.map((p) => ({ preset: p.id, values: p.values })),
  ...Array.from({ length: COUNT }, () => null),
];
for (const source of sources) {
  const patch = {};
  for (const c of controls) {
    let v;
    if (source) v = c.key in source.values ? source.values[c.key] : c.init;
    else {
      v = c.min + random() * (c.max - c.min);
      if (c.step >= 1) v = Math.round(v);
    }
    // Rendered as stored: some patches are sensitive to the fourth digit.
    patch[c.key] = round(v, 3);
  }
  const out = render(patch);
  if (!out) {
    diverged += 1;
    continue;
  }
  const d = describe(out);
  if (!d) {
    silent += 1;
    continue;
  }
  points.push({ preset: source ? source.preset : undefined, patch, d });
}
const comps = principal(points);
// Compact: the names once, each point's values as arrays in their order.
const keys = controls.map((c) => c.key);
const atlas = {
  note: { key: KEY, frequency: F0, velocity: VELOCITY, hold: 1, total: 2 },
  axes: AXES,
  controls: keys,
  components: comps.map((c) => ({ variance: round(c.variance, 3), loadings: Object.fromEntries(Object.entries(c.loadings).map(([k, v]) => [k, round(v, 3)])) })),
  points: points.map((p) => ({
    ...(p.preset ? { preset: p.preset } : {}),
    pc: p.pc.map((x) => round(x)),
    d: AXES.map((a) => round(p.d[a])),
    v: keys.map((k) => p.patch[k]),
  })),
};
writeFileSync(join(ROOT, "web/atlas.json"), JSON.stringify(atlas));
console.log(`atlas: ${points.length} sounds (${PRESETS.length} presets), ${diverged} diverged, ${silent} nearly silent; `
  + `components ${comps.map((c) => (100 * c.variance).toFixed(0) + " %").join(", ")}`);
for (const [i, c] of comps.entries()) {
  const top = Object.entries(c.loadings).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  console.log(`  PC${i + 1}: ${top.map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v.toFixed(2)}`).join(", ")}`);
}
