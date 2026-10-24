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
import { OrbitUI, computeConfigHashSync } from "./orbit-imports.js";

const MODEL = "resonator/model";

// The rank of v among sorted values, in [0, 1], linear between them (as in
// measure-worker.js).
export function percentile(sorted, v) {
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

// The value at rank q in [0, 1] among sorted values, the inverse of percentile.
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
  const table = {};
  atlas.axes.forEach((a, j) => {
    table[a] = atlas.points.map((p) => p.d[j]).sort((x, y) => x - y);
  });
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
  const goal = atlas.axes.map((a) => target[a]);
  const dist = t.ranks.map((r) => r.reduce((s, q, j) => s + (q - goal[j]) ** 2, 0) / r.length);
  let best = 0;
  let bestSame = -1;
  for (let i = 0; i < dist.length; i += 1) {
    if (dist[i] < dist[best]) best = i;
    if (atlas.points[i].v[m] === model && (bestSame < 0 || dist[i] < dist[bestSame])) bestSame = i;
  }
  const i = bestSame >= 0 && dist[bestSame] <= 1.15 * dist[best] + 1e-4 ? bestSame : best;
  const patch = Object.fromEntries(atlas.controls.map((k, j) => [k, atlas.points[i].v[j]]));
  return { patch, index: i };
}

/**
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
  const address = (a) => `/timbre/${a}`;
  const ui = [{
    type: "vgroup",
    label: "timbre",
    items: atlas.axes.map((a) => ({
      type: "hslider", label: o.axes[a][0], address: address(a), min: 0, max: 1, step: 0.01, init: 0.5,
    })),
  }];
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

  // The presets at their percentiles, the first one the most recent.
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

  // Cmd/Ctrl+Z inside this orbit, as in orbit.js.
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
    resize: () => orbit.resize(),
    destroy: () => {
      window.removeEventListener("keydown", onKey);
      orbit.destroy();
    },
  };
}
