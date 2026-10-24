// The timbre orbit: faust-orbit-ui (as in orbit.js) driven by what the sound is
// rather than by its controls. Its dots are the atlas's descriptors, each as a
// percentile among the atlas's sounds (0.5: as bright, as noisy... as the median
// sound), so that every dot spans the sounds evenly. Moving them asks for a
// sound: the page answers with the atlas's nearest sound (nearestSound), then
// refines it by measuring (measure-worker.js). Blending several neighbours'
// controls sounds further from the target than the nearest alone (a median gap
// of 21 percentiles against 11, over 30 targets): the controls of Elements do
// not mix linearly into its timbre.
//
// Its library starts with the presets at their measured percentiles: the calque
// lays them out by timbre, and morphing between its discs asks for the sounds
// in between.
//
// How it fits: app.js builds the timbre orbit in the column beside the atlas, the first
// time the Atlas tab is shown (showMap). Its `onTarget` is app.js's askTimbre, which
// loads nearestSound's patch at once and, once the dots rest, asks measure-worker.js for
// a local search; `setValues` moves the dots to the current sound's percentiles when the
// sound is changed elsewhere. app.js uses percentile and quantile too, to turn measures
// into percentiles and back.
import { OrbitUI, computeConfigHashSync } from "./orbit-imports.js";

// The model's control key: the nearest sound prefers the current model.
const MODEL = "resonator/model";

/**
 * The rank of v among sorted values, in [0, 1], linear between them (as in
 * measure-worker.js).
 * @param {number[]} sorted - values in ascending order (one descriptor over the atlas)
 * @param {number} v - a value of that descriptor
 * @returns {number} 0 at or below the smallest value, 1 at or above the largest
 */
export function percentile(sorted, v) {
  const n = sorted.length;
  if (v <= sorted[0]) return 0;
  if (v >= sorted[n - 1]) return 1;
  let lo = 0;
  let hi = n - 1;
  // Binary search for the pair of neighbours sorted[lo] <= v < sorted[hi], then the
  // fraction of the way between them (`|| 1`: equal neighbours do not divide by zero).
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid;
    else hi = mid;
  }
  return (lo + (v - sorted[lo]) / (sorted[hi] - sorted[lo] || 1)) / (n - 1);
}

/**
 * The value at rank q in [0, 1] among sorted values, the inverse of percentile: linear
 * between the two values around q * (n - 1).
 * @param {number[]} sorted - values in ascending order
 * @param {number} q - a rank, clamped to [0, 1]
 * @returns {number} a value of the descriptor
 */
export function quantile(sorted, q) {
  const x = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const i = Math.floor(x);
  return i + 1 < sorted.length ? sorted[i] + (x - i) * (sorted[i + 1] - sorted[i]) : sorted[i];
}

/**
 * What the timbre orbit needs of the atlas: each descriptor's sorted values,
 * and each sound's percentiles.
 * @param {Object} atlas - web/atlas.json
 * @returns {{table: Object<string, number[]>, ranks: number[][]}}
 */
export function timbreTable(atlas) {
  // Each descriptor's column of the atlas, sorted (a point's `d` follows `atlas.axes`).
  const table = {};
  atlas.axes.forEach((a, j) => {
    table[a] = atlas.points.map((p) => p.d[j]).sort((x, y) => x - y);
  });
  // Each sound's percentiles, in the order of `atlas.axes`, computed once for nearestSound.
  const ranks = atlas.points.map((p) => atlas.axes.map((a, j) => percentile(table[a], p.d[j])));
  return { table, ranks };
}

/**
 * The patch asked for by target percentiles: the nearest sound of the atlas
 * (mean square distance of percentiles), but the nearest of the current model
 * when it is almost as near, so that the model does not flicker while the dots
 * move.
 * @param {Object} atlas - web/atlas.json
 * @param {{ranks: number[][]}} t - from timbreTable
 * @param {Object<string, number>} target - percentiles by descriptor
 * @param {number} model - the current model
 * @returns {{patch: Object<string, number>, index: number}} the sound's controls,
 *   and its index in the atlas
 */
export function nearestSound(atlas, t, target, model) {
  const m = atlas.controls.indexOf(MODEL);
  // The target in the order of `atlas.axes`, then each sound's mean square distance to it.
  const goal = atlas.axes.map((a) => target[a]);
  const dist = t.ranks.map((r) => r.reduce((s, q, j) => s + (q - goal[j]) ** 2, 0) / r.length);
  // The nearest sound of all, and the nearest of the current model; the latter wins when
  // it is within 15 % of the former (plus a small absolute margin for targets met almost
  // exactly), so that the model does not flicker between nearly equal sounds.
  let best = 0;
  let bestSame = -1;
  for (let i = 0; i < dist.length; i += 1) {
    if (dist[i] < dist[best]) best = i;
    if (atlas.points[i].v[m] === model && (bestSame < 0 || dist[i] < dist[bestSame])) bestSame = i;
  }
  const i = bestSame >= 0 && dist[bestSame] <= 1.15 * dist[best] + 1e-4 ? bestSame : best;
  // The sound's controls by key (a point's `v` follows `atlas.controls`).
  const patch = Object.fromEntries(atlas.controls.map((k, j) => [k, atlas.points[i].v[j]]));
  return { patch, index: i };
}

/**
 * Builds the timbre orbit: one dot per descriptor, its value a percentile in [0, 1], and
 * a library seeded with the presets at their measured percentiles. Unlike orbit.js's,
 * this library is not stored: it is made again from the atlas each time.
 * @param {HTMLElement} container - the element the orbit renders into
 * @param {Object} o
 * @param {Object} o.atlas - web/atlas.json
 * @param {{table: Object<string, number[]>}} o.t - from timbreTable
 * @param {Object<string, string[]>} o.axes - each descriptor's [label, unit], localized
 * @param {(id: string) => string} o.presetName - a preset's name by id
 * @param {(target: Object<string, number>) => void} o.onTarget - the dots moved:
 *   the percentiles asked for, by descriptor
 * @param {Object} [o.tooltips] - the toolbar's tooltips, localized
 * @returns {{setValues: (target: Object<string, number>) => void, resize: () => void,
 *   destroy: () => void}}
 */
export function createTimbreOrbit(container, o) {
  const { atlas } = o;
  // The UI descriptor the component expects, as a Faust JSON `ui`: one slider per
  // descriptor, at /timbre/<descriptor>, from 0 to 1 by 0.01, starting at the median.
  const address = (a) => `/timbre/${a}`;
  const ui = [{
    type: "vgroup",
    label: "timbre",
    items: atlas.axes.map((a) => ({
      type: "hslider", label: o.axes[a][0], address: address(a), min: 0, max: 1, step: 0.01, init: 0.5,
    })),
  }];
  // The percentiles asked for, by descriptor, updated dot by dot; `frame` is the pending
  // animation frame that reports them.
  const target = Object.fromEntries(atlas.axes.map((a) => [a, 0.5]));
  let frame = 0;
  const orbit = new OrbitUI(container, {
    uiDescriptor: ui,
    onParamChange: (path, value) => {
      target[path.split("/").pop()] = value;
      // One request per frame for a burst of changes (a morph moves them all).
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          o.onTarget({ ...target });
        });
      }
    },
    tooltips: o.tooltips,
  });

  // The presets at their percentiles, the first one the most recent (`lastSeenAt` orders
  // the component's list), rounded as the sliders' step.
  const now = Date.now();
  const records = atlas.points.filter((p) => p.preset).map((p, i) => {
    const configuration = {};
    atlas.axes.forEach((a, j) => {
      configuration[address(a)] = Number(percentile(o.t.table[a], p.d[j]).toFixed(2));
    });
    return {
      uiHash: orbit.uiHash,
      configHash: computeConfigHashSync(configuration),
      name: o.presetName(p.preset),
      lastSeenAt: now - i * 1000,
      configuration,
    };
  });
  orbit.setLibrary(records);

  // Cmd/Ctrl+Z inside this orbit, as in orbit.js: with Shift a redo; the library's
  // history while the calque is open, the dots' history otherwise. The listener is on the
  // window, filtered by the container, and removed by destroy.
  const onKey = (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || event.repeat) return;
    if (!(event.target instanceof Node) || !container.contains(event.target)) return;
    event.preventDefault();
    const redo = event.shiftKey;
    if (container.classList.contains("orbit-ui-overlay-active")) {
      if (redo) orbit.redoLibrary();
      else orbit.undoLibrary();
    } else if (redo) {
      orbit.redoParams();
    } else {
      orbit.undoParams();
    }
  };
  window.addEventListener("keydown", onKey);

  return {
    // The dots at the current sound's percentiles, without asking for a sound.
    setValues: (values) => {
      const config = {};
      for (const [a, v] of Object.entries(values)) {
        target[a] = v;
        config[address(a)] = v;
      }
      orbit.setParams(config);
    },
    // The component lays its dots out from its size: called when the tab is shown again.
    resize: () => orbit.resize(),
    // Removes the key listener and the component, when app.js rebuilds the tabs.
    destroy: () => {
      window.removeEventListener("keydown", onKey);
      orbit.destroy();
    },
  };
}
