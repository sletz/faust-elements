// Measures sounds for the page, off the main thread: a patch is rendered and
// described as the atlas was (describe.js), in about 25 ms.
//
// Messages in:
//   { type: "init", voice, body }           the DSPs ({json, module}), once
//   { type: "measure", id, patch }          one patch (control values by key)
//   { type: "search", id, start, target, error, steps, ranges }
//       a local search from `start` for the patch whose descriptors are nearest
//       `target` (descriptors by name) by `error` (a percentile table, below),
//       over `steps` renders: the continuous controls of `ranges` ({key: [min,
//       max]}) move by random steps, a better patch is kept, and the step grows
//       after a success and shrinks after a failure. A later search abandons it;
//       measures are answered between its steps.
// Messages out:
//   { type: "measured", id, d, censored }   d null when diverged or nearly silent
//   { type: "found", id, patch, d, censored, error }   the best patch, at the end
//
// The error of a sound against a target is the mean square distance of their
// percentiles in the atlas, descriptor by descriptor: `error` holds the atlas's
// sorted values of each descriptor.
import { describe, render } from "./describe.js";

let voice = null;
let body = null;
// The latest search: an earlier one stops at its next step.
let latest = 0;

function measure(patch) {
  const out = render(voice, body, patch);
  return out ? describe(out) : null;
}

// The rank of v among sorted values, in [0, 1], linear between them.
function percentile(sorted, v) {
  const n = sorted.length;
  if (v <= sorted[0]) return 0;
  if (v >= sorted[n - 1]) return 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid;
    else hi = mid;
  }
  return (lo + (v - sorted[lo]) / (sorted[hi] - sorted[lo] || 1)) / (n - 1);
}

function errorOf(m, target, table) {
  if (!m) return Infinity;
  let e = 0;
  let n = 0;
  for (const [a, t] of Object.entries(target)) {
    e += (percentile(table[a], m.d[a]) - t) ** 2;
    n += 1;
  }
  return e / n;
}

// The same sequence of steps for the same search.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

async function search({ id, start, target, error: table, steps, ranges }) {
  const random = lcg(id);
  const keys = Object.keys(ranges);
  let best = { ...start };
  let bestM = measure(best);
  let bestE = errorOf(bestM, target, table);
  let sigma = 0.08;
  for (let s = 0; s < steps; s += 1) {
    // Let a newer message in; abandon if it is newer.
    await new Promise((r) => setTimeout(r, 0));
    if (latest !== id) return;
    const next = { ...best };
    for (const k of keys) {
      const [lo, hi] = ranges[k];
      // A normal step (Box-Muller), clamped to the range.
      const g = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      next[k] = Math.min(hi, Math.max(lo, best[k] + g * sigma * (hi - lo)));
      next[k] = Number(next[k].toPrecision(3));
    }
    const m = measure(next);
    const e = errorOf(m, target, table);
    if (e < bestE) {
      best = next;
      bestM = m;
      bestE = e;
      sigma = Math.min(0.3, sigma * 1.5);
    } else {
      sigma = Math.max(0.005, sigma * 0.85);
    }
  }
  postMessage({ type: "found", id, patch: best, d: bestM?.d ?? null, censored: bestM?.censored ?? false, error: bestE });
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    voice = m.voice;
    body = m.body;
    return;
  }
  if (m.type === "measure") {
    const r = measure(m.patch);
    postMessage({ type: "measured", id: m.id, d: r?.d ?? null, censored: r?.censored ?? false });
  } else if (m.type === "search") {
    latest = m.id;
    search(m);
  }
};
