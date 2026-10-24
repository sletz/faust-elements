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
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controlKey, uiItems } from "../web/faust-wasm-dsp.js";
import { AXES, LOG_AXES, NOTE, describe, render } from "../web/describe.js";
import { PRESETS } from "../web/controls.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COUNT = Number(process.argv[2] || 2000);
let seed = Number(process.argv[3] || 1);
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

// Principal components of the standardized descriptors (Jacobi rotations).
const PCA_AXES = AXES.filter((a) => a !== "loudness");
function principal(points) {
  const d = PCA_AXES.length;
  const rows = points.map((p) => PCA_AXES.map((a) => (LOG_AXES.has(a) ? Math.log(Math.max(p.d[a], 1e-3)) : p.d[a])));
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
  return { comps, projection: { axes: PCA_AXES, mean, sd } };
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
  const out = render(voiceCode, bodyCode, patch);
  if (!out) {
    diverged += 1;
    continue;
  }
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
for (const [i, c] of comps.entries()) {
  const top = Object.entries(c.loadings).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  console.log(`  PC${i + 1}: ${top.map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v.toFixed(2)}`).join(", ")}`);
}
