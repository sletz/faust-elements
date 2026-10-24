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
//
// How it fits: app.js starts this worker (a module worker) once web/atlas.json is loaded,
// posts it the compiled DSPs with "init" (a WebAssembly.Module crosses postMessage
// without being compiled again), then a "measure" after every change of the sound (at
// most one in flight) and a "search" when the timbre orbit asks for a sound. Every render
// builds fresh instances of the DSPs (describe.js's render), so that no state carries
// over from one patch to the next.
import { describe, render } from "./describe.js";

// The compiled DSPs ({json, module}), set by "init".
let voice = null;
let body = null;
// The id of the latest search: an earlier one stops at its next step.
let latest = 0;

/**
 * Renders NOTE (describe.js) with a patch and describes it.
 * @param {Object<string, number>} patch - control values by key
 * @returns {{d: Object<string, number>, censored: boolean}|null} the descriptors by name
 *   and whether the decay was extrapolated; null when the voice diverged or the sound is
 *   nearly silent
 */
function measure(patch) {
  const out = render(voice, body, patch);
  return out ? describe(out) : null;
}

/**
 * The rank of v among sorted values, in [0, 1], linear between them. The same function as
 * timbre.js's, written again here so that the worker does not import timbre.js, which
 * brings faust-orbit-ui, a DOM component, with it.
 * @param {number[]} sorted - values in ascending order (one descriptor over the atlas)
 * @param {number} v - a value of that descriptor
 * @returns {number} 0 at or below the smallest value, 1 at or above the largest
 */
function percentile(sorted, v) {
  const n = sorted.length;
  if (v <= sorted[0]) return 0;
  if (v >= sorted[n - 1]) return 1;
  let lo = 0;
  let hi = n - 1;
  // Binary search for the pair of neighbours sorted[lo] <= v < sorted[hi].
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid;
    else hi = mid;
  }
  // The index of lo plus the fraction of the way to hi, over the last index; `|| 1` keeps
  // equal neighbours from dividing by zero.
  return (lo + (v - sorted[lo]) / (sorted[hi] - sorted[lo] || 1)) / (n - 1);
}

/**
 * The error of a measure against a target: the mean, over the descriptors of the target,
 * of the squared difference between the measure's percentile and the target's.
 * @param {{d: Object<string, number>}|null} m - a measure (from measure), null for a
 *   sound that diverged or is nearly silent
 * @param {Object<string, number>} target - the percentiles asked for, in [0, 1], by
 *   descriptor
 * @param {Object<string, number[]>} table - each descriptor's sorted values in the atlas
 * @returns {number} in [0, 1]; Infinity without a measure, so that such a patch is never
 *   kept
 */
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

/**
 * A linear congruential generator (the constants of Numerical Recipes), seeded by the
 * search's id: the same sequence of steps for the same search, so that a search can be
 * reproduced.
 * @param {number} seed - an integer, taken modulo 2^32
 * @returns {() => number} a generator of numbers in [0, 1)
 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A local search from `start` for the patch whose descriptors are nearest `target`: a
 * (1+1) evolution strategy. Every step moves each continuous control of `ranges` by a
 * normal random step of `sigma` times its range, measures the result, and keeps it if its
 * error is lower; `sigma` grows by 1.5 after a success (up to 0.3) and shrinks by 0.85
 * after a failure (down to 0.005), so that the search strides while it improves and
 * narrows near a minimum. The function yields to the event loop before every step, so
 * that a "measure" is answered in the meantime and a newer search stops this one.
 * @param {Object} m - the "search" message
 * @param {number} m.id - the search's id, also the seed of its random steps
 * @param {Object<string, number>} m.start - the patch to start from, control values by
 *   key
 * @param {Object<string, number>} m.target - the percentiles asked for, by descriptor
 * @param {Object<string, number[]>} m.error - each descriptor's sorted atlas values
 * @param {number} m.steps - the number of renders after the first one
 * @param {Object<string, number[]>} m.ranges - {key: [min, max]} of the controls moved
 * @returns {Promise<void>} posts "found" at the end; nothing when abandoned
 */
async function search({ id, start, target, error: table, steps, ranges }) {
  const random = lcg(id);
  const keys = Object.keys(ranges);
  let best = { ...start };
  let bestM = measure(best);
  let bestE = errorOf(bestM, target, table);
  // The step's standard deviation, as a fraction of each control's range.
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
      // Three significant digits, as the atlas stores its patches: some sounds move by
      // several dB with the fourth digit, and the patch found is then the one measured.
      next[k] = Number(next[k].toPrecision(3));
    }
    const m = measure(next);
    const e = errorOf(m, target, table);
    // Keep a better patch and lengthen the step; otherwise shorten it.
    if (e < bestE) {
      best = next;
      bestM = m;
      bestE = e;
      sigma = Math.min(0.3, sigma * 1.5);
    } else {
      sigma = Math.max(0.005, sigma * 0.85);
    }
  }
  // The best patch, its descriptors (null if not even the start could be measured) and
  // its error.
  postMessage({ type: "found", id, patch: best, d: bestM?.d ?? null, censored: bestM?.censored ?? false, error: bestE });
}

// The worker's entry point. "init" stores the DSPs. A "measure" is answered at once (id 0
// from the page: one measure is in flight at a time), also while a search runs, since the
// search yields between its steps. A "search" becomes the latest, which stops an earlier
// one at its next step, and runs without being awaited.
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
