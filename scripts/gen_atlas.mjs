// The atlas of the web version: random patches rendered with the page's wasm
// DSPs (web/dsp), described by what they sound like, and laid out on a plane.
//
//   node scripts/gen_atlas.mjs [COUNT] [SEED]     (make web-atlas)
//
// Writes web/atlas.json. Each patch draws every control of the voice and the
// body in its range (the model a whole number, the pitch offset left at 0), as
// the orbit's Random does; the 24 presets are added as landmarks. Each is played
// and measured by web/describe.js (the note, the descriptors and their
// definitions are there), as the page measures the current sound. A patch that
// diverges or stays nearly silent is left out.
//
// The plane is the first two principal components of the standardized
// descriptors but the loudness, which follows the level rather than the timbre
// (brightness, attack and decay on a log scale). The atlas keeps the
// standardization, so that the page can place a new sound on it.
//
// COUNT: the number of random patches (default 2000); SEED: the generator's seed
// (default 1), so that the same arguments give the same atlas. Inputs: web/dsp
// (make web), web/controls.js (the presets), web/describe.js. Output:
// web/atlas.json, compact JSON:
//
//   note        the note every sound is played with (describe.js's NOTE)
//   axes        the descriptors' names, the order of each point's `d`
//   projection  {axes, mean, sd}: the descriptors of the plane, and the mean and
//               standard deviation of each (of its log for a log axis), to
//               standardize a new sound as the atlas's were
//   controls    the controls' keys, the order of each point's `v`
//   components  the two components: the share of the variance each explains, and
//               its loadings (weight of each standardized descriptor)
//   points      one per sound: `preset` (its id, for a preset), `c: 1` (its decay
//               extrapolated), `pc` (its two coordinates), `d` (its descriptors),
//               `v` (its controls)
//
// On stdout: the number of sounds kept and left out, the variance of each
// component, and the three descriptors that weigh most in each.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controlKey, uiItems } from "../web/faust-wasm-dsp.js";
import { AXES, LOG_AXES, NOTE, describe, render } from "../web/describe.js";
import { PRESETS } from "../web/controls.js";

// The repository root, from this file's location.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COUNT = Number(process.argv[2] || 2000);
let seed = Number(process.argv[3] || 1);
// Controls not drawn: the note's (set by describe.js's NOTE) and the pitch offset,
// which would only transpose the note every sound is measured at.
const FIXED = new Set(["freq", "gain", "gate", "performance/modulation"]);

/**
 * The next number of a 32-bit linear congruential generator (the constants of
 * Numerical Recipes, as in fuzz_web.mjs): seeded, so that an atlas can be made
 * again. `>>> 0` keeps the state an unsigned 32-bit integer.
 * @returns {number} a number in [0, 1)
 */
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

/**
 * Loads one of the page's compiled DSPs.
 * @param {string} name - "voice" or "body", the stem of web/dsp/NAME.{json,wasm}
 * @returns {{json: Object, module: WebAssembly.Module}} the program's JSON
 *   description and its compiled module, the argument FaustWasmDsp expects
 */
function load(name) {
  const json = JSON.parse(readFileSync(join(ROOT, "web/dsp", name + ".json"), "utf8"));
  const module = new WebAssembly.Module(readFileSync(join(ROOT, "web/dsp", name + ".wasm")));
  return { json, module };
}

const voiceCode = load("voice");
const bodyCode = load("body");
// The controls of a patch: every control with a range of the voice and the body
// but FIXED, once each, with its range, step and default (a preset's value for the
// controls it does not give).
const controls = [];
for (const j of [voiceCode.json, bodyCode.json]) {
  for (const item of uiItems(j.ui)) {
    const key = controlKey(item.address);
    if (item.min === undefined || FIXED.has(key) || controls.some((c) => c.key === key)) continue;
    controls.push({ key, min: Number(item.min), max: Number(item.max), step: Number(item.step), init: Number(item.init) });
  }
}

// Principal components of the standardized descriptors (Jacobi rotations).
const PCA_AXES = AXES.filter((a) => a !== "loudness");
/**
 * The first two principal components of the points' descriptors, and each point's
 * coordinates on them.
 *
 * Each descriptor of PCA_AXES (on a log scale for LOG_AXES, floored at 1e-3 so
 * that the log stays finite) is standardized to a mean of 0 and a standard
 * deviation of 1 over the points; the covariance matrix of the standardized
 * values (their correlation matrix) is diagonalized by the cyclic Jacobi method;
 * its eigenvectors are the components, its eigenvalues their variances.
 *
 * @param {Array<{d: Object<string, number>}>} points - the measured sounds, `d`
 *   their descriptors by name; each gets `pc`, its two coordinates
 * @returns {{comps: Array<{variance: number, loadings: Object<string, number>}>,
 *   projection: {axes: Array<string>, mean: Array<number>, sd: Array<number>}}}
 *   the two components (the share of the total variance each explains, and the
 *   weight of each standardized descriptor), and what is needed to standardize a
 *   new sound
 */
function principal(points) {
  const d = PCA_AXES.length;
  const rows = points.map((p) => PCA_AXES.map((a) => (LOG_AXES.has(a) ? Math.log(Math.max(p.d[a], 1e-3)) : p.d[a])));
  // The mean and the population standard deviation (over n) of each descriptor; a
  // descriptor constant over every point gets 1, rather than a division by zero.
  const mean = PCA_AXES.map((_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length);
  const sd = PCA_AXES.map((_, j) => Math.sqrt(rows.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / rows.length) || 1);
  const z = rows.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  // c: the d x d covariance of z, made diagonal in place; v: the product of the
  // rotations, from the identity, whose columns become the eigenvectors.
  const c = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => z.reduce((s, r) => s + r[i] * r[j], 0) / z.length));
  const v = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)));
  // Cyclic Jacobi: each sweep visits every pair p < q and applies the plane
  // rotation R(p, q, theta) that zeroes c[p][q], c <- R^T c R, v <- v R. The
  // off-diagonal terms shrink quadratically once small: a 7 x 7 matrix converges
  // in a few sweeps, and the later ones skip every pair (|c[p][q]| < 1e-12).
  for (let sweep = 0; sweep < 100; sweep += 1) {
    for (let p = 0; p < d; p += 1) {
      for (let q = p + 1; q < d; q += 1) {
        if (Math.abs(c[p][q]) < 1e-12) continue;
        // The new c[p][q] is cos(2 theta) c[p][q] + sin(2 theta) (c[p][p] - c[q][q]) / 2,
        // zero for tan(2 theta) = 2 c[p][q] / (c[q][q] - c[p][p]); atan2 picks the
        // angle even when the diagonal terms are equal.
        const theta = 0.5 * Math.atan2(2 * c[p][q], c[q][q] - c[p][p]);
        const cs = Math.cos(theta);
        const sn = Math.sin(theta);
        // c <- c R: columns p and q.
        for (let k = 0; k < d; k += 1) {
          const ckp = c[k][p];
          const ckq = c[k][q];
          c[k][p] = cs * ckp - sn * ckq;
          c[k][q] = sn * ckp + cs * ckq;
        }
        // c <- R^T c: rows p and q.
        for (let k = 0; k < d; k += 1) {
          const cpk = c[p][k];
          const cqk = c[q][k];
          c[p][k] = cs * cpk - sn * cqk;
          c[q][k] = sn * cpk + cs * cqk;
        }
        // v <- v R: the eigenvectors accumulate the rotations.
        for (let k = 0; k < d; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = cs * vkp - sn * vkq;
          v[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  // The eigenvalues by decreasing size; their sum is the trace, the total variance
  // (d for standardized descriptors). The sign of an eigenvector is arbitrary, so
  // the direction of each axis of the plane is too.
  const order = PCA_AXES.map((_, i) => i).sort((a, b) => c[b][b] - c[a][a]);
  const totalVar = order.reduce((s, i) => s + c[i][i], 0);
  const comps = order.slice(0, 2).map((i) => ({
    variance: c[i][i] / totalVar,
    loadings: Object.fromEntries(PCA_AXES.map((a, j) => [a, v[j][i]])),
  }));
  // A point's coordinate on a component: its standardized descriptors projected on
  // the component's loadings.
  points.forEach((p, n) => {
    p.pc = comps.map((comp) => PCA_AXES.reduce((s, a, j) => s + z[n][j] * comp.loadings[a], 0));
  });
  return { comps, projection: { axes: PCA_AXES, mean, sd } };
}

/**
 * Rounds to significant digits, to keep the JSON small.
 * @param {number} x
 * @param {number} [k=4] - the number of significant digits
 * @returns {number} x with k significant digits
 */
const round = (x, k = 4) => Number(x.toPrecision(k));
const points = [];
let diverged = 0;
let silent = 0;
// What to render: the presets first (each with its id and values), then COUNT
// random patches (null: drawn below).
const sources = [
  ...PRESETS.map((p) => ({ preset: p.id, values: p.values })),
  ...Array.from({ length: COUNT }, () => null),
];
for (const source of sources) {
  const patch = {};
  for (const c of controls) {
    let v;
    // A preset's value, or the control's default where the preset gives none; or a
    // value drawn uniformly in the range, whole for a control with a step of 1 or
    // more (the model), as the orbit's Random draws it.
    if (source) v = c.key in source.values ? source.values[c.key] : c.init;
    else {
      v = c.min + random() * (c.max - c.min);
      if (c.step >= 1) v = Math.round(v);
    }
    // Rendered as stored: some patches are sensitive to the fourth digit.
    patch[c.key] = round(v, 3);
  }
  // null when the voice diverged (describe.js's guard), as the page would clear it.
  const out = render(voiceCode, bodyCode, patch);
  if (!out) {
    diverged += 1;
    continue;
  }
  // null when the sound's loudest frame is below -60 dBFS (describe.js's SILENT_DB).
  const measured = describe(out);
  if (!measured) {
    silent += 1;
    continue;
  }
  points.push({ preset: source ? source.preset : undefined, patch, d: measured.d, censored: measured.censored });
}
const { comps, projection } = principal(points);
// Compact: the names once, each point's values as arrays in their order.
const keys = controls.map((c) => c.key);
// The standardization keeps 8 digits, the loadings and variances 3, the
// coordinates and descriptors 4: enough for a plot and for placing a new sound.
const atlas = {
  note: NOTE,
  axes: AXES,
  projection: { ...projection, mean: projection.mean.map((x) => round(x, 8)), sd: projection.sd.map((x) => round(x, 8)) },
  controls: keys,
  components: comps.map((c) => ({ variance: round(c.variance, 3), loadings: Object.fromEntries(Object.entries(c.loadings).map(([k, v]) => [k, round(v, 3)])) })),
  points: points.map((p) => ({
    ...(p.preset ? { preset: p.preset } : {}),
    // The decay outlasted the render: it is extrapolated.
    ...(p.censored ? { c: 1 } : {}),
    pc: p.pc.map((x) => round(x)),
    d: AXES.map((a) => round(p.d[a])),
    v: keys.map((k) => p.patch[k]),
  })),
};
writeFileSync(join(ROOT, "web/atlas.json"), JSON.stringify(atlas));
console.log(`atlas: ${points.length} sounds, ${points.filter((p) => p.censored).length} decays extrapolated (${PRESETS.length} presets), ${diverged} diverged, ${silent} nearly silent; `
  + `components ${comps.map((c) => (100 * c.variance).toFixed(0) + " %").join(", ")}`);
// The three descriptors with the largest loadings, in absolute value, of each
// component: what each axis of the plane mostly measures.
for (const [i, c] of comps.entries()) {
  const top = Object.entries(c.loadings).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  console.log(`  PC${i + 1}: ${top.map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v.toFixed(2)}`).join(", ")}`);
}
